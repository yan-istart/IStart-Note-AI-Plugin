export const PUBLISHING_PLATFORMS = [
  { id: "weixin", name: "微信公众号" },
  { id: "zhihu", name: "知乎" },
  { id: "bilibili", name: "B 站专栏" },
] as const;

export interface PublishingSettings { folder: string }
export const DEFAULT_PUBLISHING_SETTINGS: PublishingSettings = { folder: "IStart/Publishing" };
export function publishingFolder(value: string): string {
  const path = value.trim().replace(/\/+$/, "");
  if (!path || /[\\:*?"<>|]/.test(path) || Array.from(path).some(c => c.charCodeAt(0) < 32) || path.split("/").some(p => !p || p.startsWith(".") || p.trim() !== p)) throw new Error("请设置有效的 Vault 内分发目录");
  return path;
}
export function loadPublishingSettings(saved?: Partial<PublishingSettings>): PublishingSettings {
  try { return { folder: publishingFolder(saved?.folder ?? DEFAULT_PUBLISHING_SETTINGS.folder) }; }
  catch { return { ...DEFAULT_PUBLISHING_SETTINGS }; }
}
export interface PublishingAccount { id: string; name: string; isAuthenticated: boolean; username?: string; userId?: string }
export type DeliveryState = "pending" | "sending" | "draft" | "failed" | "unknown";
export interface DeliveryResult { platform: string; username?: string; state: DeliveryState; postId?: string; postUrl?: string; error?: string }
export interface PublishingJob { id: string; serverId: string; createdAt: string; state: "sending" | "complete"; results: DeliveryResult[] }
export interface PublishingStatus { protocol: "istart-publishing-v1"; serverId: string; extensionConnected: boolean }
export interface PublishingArticle { title: string; markdown: string; cover?: string }
export interface PublishingRequest { id: string; article: PublishingArticle; accounts: PublishingAccount[] }
export interface PublishingAsset { name: string; data: ArrayBuffer; mime: string; source: string }
export interface CompiledArticle { title: string; markdown: string; assets: PublishingAsset[]; warnings: string[] }
export interface PublishingSnapshot { folder: string; sourcePath: string; title: string; markdown: string; assets: PublishingAsset[]; fingerprint: string; noteContent: string }
export interface PublishingRecord { version: 1; serviceUrl: string; snapshotFolder: string; fingerprint: string; job: PublishingJob }

export function sanitizeRemoteUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = ""; url.password = "";
    for (const key of [...url.searchParams.keys()]) if (/token|ticket|secret|auth|key|session|cookie/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch { return undefined; }
}
export async function contentFingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function binaryFingerprint(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function base64Image(asset: PublishingAsset): string {
  const bytes = new Uint8Array(asset.data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${asset.mime};base64,${btoa(binary)}`;
}
