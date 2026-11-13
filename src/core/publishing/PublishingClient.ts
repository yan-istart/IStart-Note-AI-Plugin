import { requestUrl } from "obsidian";
import type { PublishingAccount, PublishingJob, PublishingRequest, PublishingStatus } from "./types";

export function serviceUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请输入完整服务地址，例如 https://publish.example.com"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("服务地址仅支持 HTTP/HTTPS，凭证请单独填写");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("远程服务请使用 HTTPS；本机服务可以使用 HTTP");
  return url.toString().replace(/\/+$/, "");
}
export function parseJob(value: unknown): PublishingJob {
  if (!value || typeof value !== "object") throw new Error("服务返回了无效的任务");
  const job = value as Partial<PublishingJob>;
  if (typeof job.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(job.id) || typeof job.serverId !== "string" || typeof job.createdAt !== "string" || !["sending", "complete"].includes(job.state ?? "") || !Array.isArray(job.results) || !job.results.length || job.results.some(r => !r || !["weixin", "zhihu", "bilibili"].includes(r.platform) || !["pending", "sending", "draft", "failed", "unknown"].includes(r.state))) throw new Error("服务任务格式不兼容");
  return job as PublishingJob;
}
export class PublishingHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export class PublishingClient {
  readonly url: string;
  constructor(url: string, private token: string) {
    this.url = serviceUrl(url);
    if (token.length < 24) throw new Error("请填写至少 24 个字符的服务访问令牌");
  }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const request = requestUrl({ url: this.url + path, method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), throw: false });
    let timer: number | undefined;
    try {
      const response = await Promise.race([request, new Promise<never>((_resolve, reject) => { timer = window.setTimeout(() => reject(new Error("服务响应超时，请查询任务状态，避免重复发送")), 20000); })]);
      if (response.status < 200 || response.status >= 300) {
        const messages: Record<number, string> = { 401: "服务访问令牌无效", 404: "服务地址或任务不存在，请核对服务及平台草稿", 409: "服务已有发送任务或任务标识冲突，请稍后查询", 413: "图文数据过大，请压缩图片" };
        throw new PublishingHttpError(messages[response.status] ?? `分发服务暂不可用（${response.status}）`, response.status);
      }
      return response.json as unknown;
    } finally { if (timer) window.clearTimeout(timer); }
  }
  async status(): Promise<PublishingStatus> {
    const value = await this.request("/v1/status");
    const status = value as Partial<PublishingStatus> | null;
    if (!status || status.protocol !== "istart-publishing-v1" || typeof status.serverId !== "string" || typeof status.extensionConnected !== "boolean") throw new Error("此地址不是兼容的 IStart 分发服务");
    return status as PublishingStatus;
  }
  async accounts(): Promise<PublishingAccount[]> {
    const value = await this.request("/v1/platforms");
    if (!Array.isArray(value)) throw new Error("服务账号信息无效");
    return value.filter((item: unknown): item is PublishingAccount => {
      if (!item || typeof item !== "object") return false;
      const a = item as Partial<PublishingAccount>;
      return typeof a.id === "string" && ["weixin", "zhihu", "bilibili"].includes(a.id) && typeof a.isAuthenticated === "boolean" && (a.username === undefined || typeof a.username === "string");
    });
  }
  async send(request: PublishingRequest): Promise<PublishingJob> { return parseJob(await this.request("/v1/jobs", request)); }
  async job(id: string): Promise<PublishingJob> {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error("任务标识无效");
    return parseJob(await this.request(`/v1/jobs/${id}`));
  }
}
