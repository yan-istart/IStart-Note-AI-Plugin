import { TFile, Platform } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { readNote } from "../../core/agent/Context";
import { compileArticle } from "../../core/publishing/ContentCompiler";
import { PublishingClient, PublishingHttpError } from "../../core/publishing/PublishingClient";
import { base64Image, contentFingerprint } from "../../core/publishing/types";
import type { CompiledArticle, PublishingAccount, PublishingRecord, PublishingSnapshot, PublishingStatus } from "../../core/publishing/types";
import { PublishingStore } from "./PublishingStore";
import { PublishingDeviceConfig } from "./DeviceConfig";

export class PublishingController {
  readonly device: PublishingDeviceConfig;
  readonly store: PublishingStore;
  article: CompiledArticle | null = null;
  sourcePath = "";
  private sourceContent = "";
  snapshot: PublishingSnapshot | null = null;
  cover = "";
  accounts: PublishingAccount[] = [];
  selected = new Set<string>();
  connection: PublishingStatus | null = null;
  records: PublishingRecord[] = [];
  message = "选择笔记并生成分发预览。首版发送到公众号、知乎、B 站专栏草稿。";
  busy = false;
  private listeners = new Set<() => void>();
  private timer: number | null = null;
  private disposed = false;
  private polling = false;
  constructor(private plugin: DeepSeekPlugin) {
    this.device = new PublishingDeviceConfig(plugin.app);
    if (Platform.isMobile) this.device.value.mode = "remote";
    this.store = new PublishingStore(plugin.app, () => plugin.settings.publishing.folder);
  }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  notify(): void { if (!this.disposed) [...this.listeners].forEach(listener => listener()); }
  async load(): Promise<void> { this.records = await this.store.records(); this.notify(); }
  get url(): string { return this.device.value.mode === "local" && !Platform.isMobile ? `http://127.0.0.1:${this.device.value.port}` : this.device.value.url; }
  private client(): PublishingClient { return new PublishingClient(this.url, this.device.token); }
  async action(work: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.notify();
    try { await work(); }
    catch (error) { this.message = error instanceof Error ? error.message : "分发操作失败"; }
    finally { this.busy = false; this.notify(); }
  }
  resetConnection(notify = true): void { this.connection = null; this.accounts = []; this.selected.clear(); this.device.save(); if (notify) this.notify(); }
  async connect(): Promise<void> {
    this.connection = null; this.accounts = []; this.selected.clear();
    const client = this.client();
    this.connection = await client.status();
    if (this.connection.extensionConnected) this.accounts = await client.accounts();
    this.message = this.connection.extensionConnected ? "服务与浏览器扩展已连接，请核对账号并选择平台。" : "已连接服务，等待浏览器扩展连接。请按部署说明配置扩展。";
  }
  async prepare(file: TFile | null): Promise<void> {
    if (!file || file.extension !== "md") throw new Error("请先选择 Markdown 笔记");
    const content = await readNote(this.plugin.app, file.path);
    if (content === null) throw new Error("找不到所选笔记");
    const article = await compileArticle(content, file.basename, async link => {
      const image = this.plugin.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!(image instanceof TFile)) return null;
      return { path: image.path, data: await this.plugin.app.vault.readBinary(image) };
    });
    this.article = article; this.sourcePath = file.path; this.sourceContent = content; this.snapshot = null; this.cover = "";
    this.message = `已生成预览：${article.title} · ${article.assets.length} 张本地图片`;
  }
  async saveSnapshot(): Promise<void> {
    if (!this.article) throw new Error("请先生成预览");
    if (!this.article.title.trim() || this.article.title.length > 200 || /[\r\n]/.test(this.article.title)) throw new Error("分发标题应为 1–200 个字符的单行文字");
    await this.assertCurrent();
    if (!this.snapshot) this.snapshot = await this.store.snapshot(this.article, this.sourcePath);
    await this.store.assertSnapshot(this.snapshot);
    this.message = `分发快照已保存：${this.snapshot.folder}`;
  }
  private async assertCurrent(): Promise<void> {
    if (await readNote(this.plugin.app, this.sourcePath) !== this.sourceContent) throw new Error("原文已变化，请重新生成预览");
    for (const asset of this.article?.assets ?? []) {
      const file = this.plugin.app.vault.getAbstractFileByPath(asset.source);
      if (!(file instanceof TFile)) throw new Error("图片已移动或删除，请重新生成预览");
      const current = await this.plugin.app.vault.readBinary(file);
      const a = new Uint8Array(current), b = new Uint8Array(asset.data);
      if (a.length !== b.length || a.some((byte, i) => byte !== b[i])) throw new Error("图片已变化，请重新生成预览");
    }
  }
  async send(platforms = [...this.selected]): Promise<void> {
    if (!this.article || !this.connection?.extensionConnected) throw new Error("请先预览稿件并测试服务连接");
    const accounts = platforms.map(id => this.accounts.find(account => account.id === id));
    if (!accounts.length || accounts.some(account => !account?.isAuthenticated || !account.username)) throw new Error("请选择已登录且可识别账号的平台");
    if (this.records.some(r => r.job.state === "sending" && r.job.results.some(result => ["pending", "sending"].includes(result.state)) && r.serviceUrl === this.client().url)) throw new Error("存在尚未完成的任务，请先刷新发送记录");
    await this.saveSnapshot();
    const snapshot = this.snapshot!;
    let markdown = snapshot.markdown;
    for (const asset of snapshot.assets) markdown = markdown.split(`](assets/${asset.name})`).join(`](${base64Image(asset)})`);
    const article = { title: snapshot.title, markdown, ...(this.cover ? { cover: base64Image(snapshot.assets.find(a => a.name === this.cover)!) } : {}) };
    const fingerprint = await contentFingerprint(JSON.stringify(article));
    const duplicate = this.records.find(record => record.fingerprint === fingerprint && record.job.results.some(result => accounts.some(account => account!.id === result.platform && account!.username === result.username) && ["pending", "sending", "draft", "unknown"].includes(result.state)));
    if (duplicate) throw new Error("此版本在所选平台已有草稿或结果待核对，请查看发送记录");
    const client = this.client();
    const current = await client.status();
    if (current.serverId !== this.connection.serverId || !current.extensionConnected) throw new Error("服务或浏览器连接已变化，请重新测试连接");
    const id = crypto.randomUUID();
    const record: PublishingRecord = { version: 1, serviceUrl: client.url, snapshotFolder: snapshot.folder, fingerprint,
      job: { id, serverId: current.serverId, createdAt: new Date().toISOString(), state: "sending", results: accounts.map(account => ({ platform: account!.id, username: account!.username, state: "pending" })) } };
    // Persist intent before POST: a lost response must never turn into a new request ID.
    await this.store.saveRecord(record); this.records.unshift(record); this.notify();
    try {
      const job = await client.send({ id, article, accounts: accounts as PublishingAccount[] });
      if (job.id !== id || job.serverId !== current.serverId) throw new Error("任务来源不匹配");
      record.job = job; await this.store.saveRecord(record);
      this.message = "分发任务已提交，正在等待各平台草稿结果。";
    } catch (error) {
      const rejected = error instanceof PublishingHttpError && [400, 401, 403, 404, 409, 413, 415, 429].includes(error.status);
      record.job.results.forEach(result => { result.state = rejected ? "failed" : "unknown"; result.error = rejected ? "服务拒绝提交，请检查连接后重试" : "提交结果未知，请刷新记录或到平台核对，勿重复发送"; });
      if (rejected) record.job.state = "complete";
      await this.store.saveRecord(record); this.message = rejected ? error.message : "提交结果未知，已保留任务编号，请刷新记录查询。";
    }
    this.schedule();
  }
  private schedule(): void {
    if (this.timer) window.clearTimeout(this.timer);
    if (this.disposed || !this.records.some(r => r.job.state === "sending")) return;
    this.timer = window.setTimeout(() => { void this.refresh().catch(() => { /* Manual refresh can recover after a network loss. */ }); }, 2000);
  }
  async refresh(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const client = this.client(), status = await client.status();
      for (const record of this.records.filter(r => r.job.state === "sending" && r.serviceUrl === client.url && r.job.serverId === status.serverId)) {
        const job = await client.job(record.job.id);
        if (job.id !== record.job.id || job.serverId !== record.job.serverId) throw new Error("返回的任务来源不匹配");
        record.job = job; await this.store.saveRecord(record);
      }
      const elsewhere = this.records.some(record => record.job.state === "sending" && (record.serviceUrl !== client.url || record.job.serverId !== status.serverId));
      this.message = elsewhere ? "当前服务记录已刷新；部分未完成任务属于其他服务，请连接原服务查询。" : "发送记录已刷新。草稿保存后，请到目标平台检查排版与图片。";
      this.notify(); this.schedule();
    } finally { this.polling = false; }
  }
  async retry(record: PublishingRecord): Promise<void> {
    const failed = record.job.results.filter(result => result.state === "failed").map(result => result.platform);
    if (!failed.length) throw new Error("仅明确失败的平台可以重试；结果未知时请先到平台核对");
    if (!this.snapshot || this.snapshot.folder !== record.snapshotFolder) {
      const file = this.plugin.app.vault.getAbstractFileByPath(`${record.snapshotFolder}/稿件.md`);
      if (!(file instanceof TFile)) throw new Error("找不到原发送稿件");
      await this.prepare(file); this.selected = new Set(failed);
      this.message = "已载入失败任务的稿件，请核对预览及账号，再点击发送到所选平台草稿。";
      return;
    }
    await this.send(failed);
  }
  dispose(): void { this.disposed = true; if (this.timer) window.clearTimeout(this.timer); this.listeners.clear(); }
}
