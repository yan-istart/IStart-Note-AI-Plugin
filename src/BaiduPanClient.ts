/**
 * 百度网盘开放平台 REST API 封装
 * 文档：https://pan.baidu.com/union/doc
 *
 * 上传流程（分片预上传）：
 *   1. precreate  → 获取 uploadid
 *   2. superfile2 → 逐片上传（每片最大 4MB）
 *   3. create     → 合并文件
 */

import { requestUrl } from "obsidian";
import { BaiduSyncConfig } from "./types";
import { md5 } from "./md5";

const PAN_API = "https://pan.baidu.com/rest/2.0/xpan";
const UPLOAD_API = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
const OAUTH_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB

export interface BaiduFileEntry {
  fs_id: number;
  path: string;
  server_filename: string;
  size: number;
  isdir: number;
  server_mtime: number;
  server_ctime: number;
  md5?: string;
}

export interface BaiduUserInfo {
  baidu_name: string;
  netdisk_name: string;
  uk: number;
  vip_type: number;
  avatar_url: string;
}

export class BaiduPanClient {
  constructor(private config: BaiduSyncConfig) {}

  // ── OAuth ──────────────────────────────────────────────────

  static buildAuthUrl(appId: string): string {
    return `https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=${appId}&redirect_uri=oob&scope=basic,netdisk&display=popup`;
  }

  async exchangeToken(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
    try {
      const res = await requestUrl({
        url: `${OAUTH_TOKEN_URL}?grant_type=authorization_code&code=${encodeURIComponent(code)}&client_id=${this.config.appId}&client_secret=${this.config.appSecret}&redirect_uri=oob`,
        method: "GET",
        throw: false,
      });
      if (res.status !== 200) {
        console.error("[BaiduPan] exchangeToken failed:", res.status, res.text);
        return null;
      }
      const d = res.json;
      if (d.error) {
        console.error("[BaiduPan] exchangeToken error:", d.error, d.error_description);
        return null;
      }
      return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: d.expires_in };
    } catch (e) {
      console.error("[BaiduPan] exchangeToken exception:", e);
      return null;
    }
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresIn: number } | null> {
    try {
      const res = await requestUrl({
        url: `${OAUTH_TOKEN_URL}?grant_type=refresh_token&refresh_token=${this.config.refreshToken}&client_id=${this.config.appId}&client_secret=${this.config.appSecret}`,
        method: "GET",
        throw: false,
      });
      if (res.status !== 200) return null;
      const d = res.json;
      if (d.error) return null;
      return { accessToken: d.access_token, expiresIn: d.expires_in };
    } catch {
      return null;
    }
  }

  isTokenExpired(): boolean {
    if (!this.config.tokenExpiresAt) return true;
    return Date.now() > new Date(this.config.tokenExpiresAt).getTime() - 5 * 60 * 1000;
  }

  // ── 用户信息 ───────────────────────────────────────────────

  async getUserInfo(): Promise<BaiduUserInfo | null> {
    try {
      const res = await requestUrl({
        url: `https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${this.config.accessToken}`,
        method: "GET",
        headers: { "User-Agent": "pan.baidu.com" },
        throw: false,
      });
      if (res.status !== 200 || res.json.errno !== 0) return null;
      return res.json as BaiduUserInfo;
    } catch {
      return null;
    }
  }

  // ── 文件列表 ───────────────────────────────────────────────

  async listFiles(dir: string, start = 0, limit = 1000): Promise<BaiduFileEntry[]> {
    try {
      const url = `${PAN_API}/file?method=list&access_token=${this.config.accessToken}&dir=${encodeURIComponent(dir)}&order=name&start=${start}&limit=${limit}`;
      const res = await requestUrl({ url, method: "GET", headers: { "User-Agent": "pan.baidu.com" }, throw: false });
      if (res.status !== 200 || res.json.errno !== 0) {
        console.error("[BaiduPan] listFiles error:", res.json?.errno, res.json?.errmsg);
        return [];
      }
      return res.json.list as BaiduFileEntry[];
    } catch {
      return [];
    }
  }

  async listAllFiles(dir: string): Promise<BaiduFileEntry[]> {
    const result: BaiduFileEntry[] = [];
    const entries = await this.listFiles(dir);
    for (const entry of entries) {
      if (entry.isdir) {
        const children = await this.listAllFiles(entry.path);
        result.push(...children);
      } else {
        result.push(entry);
      }
    }
    return result;
  }

  // ── 创建目录 ───────────────────────────────────────────────

  async mkdir(path: string): Promise<boolean> {
    try {
      const body = `path=${encodeURIComponent(path)}&isdir=1&rtype=0`;
      const res = await requestUrl({
        url: `${PAN_API}/file?method=create&access_token=${this.config.accessToken}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "pan.baidu.com" },
        body,
        throw: false,
      });
      // errno -8 = 目录已存在，视为成功
      return res.status === 200 && (res.json.errno === 0 || res.json.errno === -8);
    } catch {
      return false;
    }
  }

  // ── 上传 ───────────────────────────────────────────────────

  async uploadFile(content: ArrayBuffer, remotePath: string): Promise<boolean> {
    const bytes = new Uint8Array(content);

    // 分片
    const chunks = this.splitChunks(bytes);
    const blockMd5List = chunks.map((c) => md5(c));

    console.log(`[BaiduPan] upload ${remotePath}, size=${bytes.length}, chunks=${chunks.length}`);

    // Step 1: precreate
    const uploadId = await this.precreate(remotePath, bytes.length, blockMd5List);
    if (!uploadId) {
      console.error("[BaiduPan] precreate failed for", remotePath);
      return false;
    }

    // Step 2: 逐片上传
    for (let i = 0; i < chunks.length; i++) {
      const ok = await this.uploadChunk(chunks[i], remotePath, uploadId, i);
      if (!ok) {
        console.error(`[BaiduPan] uploadChunk failed at part ${i} for`, remotePath);
        return false;
      }
    }

    // Step 3: create（合并）
    const created = await this.createFile(remotePath, bytes.length, uploadId, blockMd5List);
    if (!created) {
      console.error("[BaiduPan] createFile failed for", remotePath);
    }
    return created;
  }

  private async precreate(remotePath: string, size: number, blockMd5List: string[]): Promise<string | null> {
    try {
      // 注意：block_list 的值是 JSON 字符串，不需要再 encodeURIComponent
      const body = new URLSearchParams({
        path: remotePath,
        size: String(size),
        isdir: "0",
        autoinit: "1",
        rtype: "3",
        block_list: JSON.stringify(blockMd5List),
      }).toString();

      const res = await requestUrl({
        url: `${PAN_API}/file?method=precreate&access_token=${this.config.accessToken}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "pan.baidu.com" },
        body,
        throw: false,
      });

      if (res.status !== 200 || res.json.errno !== 0) {
        console.error("[BaiduPan] precreate response:", res.status, JSON.stringify(res.json));
        return null;
      }
      return res.json.uploadid as string;
    } catch (e) {
      console.error("[BaiduPan] precreate exception:", e);
      return null;
    }
  }

  private async uploadChunk(chunk: Uint8Array, remotePath: string, uploadId: string, partseq: number): Promise<boolean> {
    try {
      const boundary = "BaiduPanBoundary" + Math.random().toString(36).slice(2);
      const headerStr = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const footerStr = `\r\n--${boundary}--\r\n`;

      const headerBytes = new TextEncoder().encode(headerStr);
      const footerBytes = new TextEncoder().encode(footerStr);

      // 使用独立的 ArrayBuffer（避免共享内存问题）
      const bodyBuf = new ArrayBuffer(headerBytes.length + chunk.length + footerBytes.length);
      const bodyView = new Uint8Array(bodyBuf);
      bodyView.set(headerBytes, 0);
      bodyView.set(chunk, headerBytes.length);
      bodyView.set(footerBytes, headerBytes.length + chunk.length);

      const url = `${UPLOAD_API}?method=upload&access_token=${this.config.accessToken}&type=tmpfile&path=${encodeURIComponent(remotePath)}&uploadid=${uploadId}&partseq=${partseq}`;

      const res = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "User-Agent": "pan.baidu.com",
        },
        body: bodyBuf,
        throw: false,
      });

      if (res.status !== 200 || !res.json?.md5) {
        console.error(`[BaiduPan] uploadChunk part=${partseq} response:`, res.status, JSON.stringify(res.json));
        return false;
      }
      return true;
    } catch (e) {
      console.error(`[BaiduPan] uploadChunk part=${partseq} exception:`, e);
      return false;
    }
  }

  private async createFile(remotePath: string, size: number, uploadId: string, blockMd5List: string[]): Promise<boolean> {
    try {
      const body = new URLSearchParams({
        path: remotePath,
        size: String(size),
        isdir: "0",
        rtype: "3",
        uploadid: uploadId,
        block_list: JSON.stringify(blockMd5List),
      }).toString();

      const res = await requestUrl({
        url: `${PAN_API}/file?method=create&access_token=${this.config.accessToken}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "pan.baidu.com" },
        body,
        throw: false,
      });

      if (res.status !== 200 || res.json.errno !== 0) {
        console.error("[BaiduPan] createFile response:", res.status, JSON.stringify(res.json));
        return false;
      }
      return true;
    } catch (e) {
      console.error("[BaiduPan] createFile exception:", e);
      return false;
    }
  }

  // ── 下载 ───────────────────────────────────────────────────

  async downloadFile(remotePath: string): Promise<ArrayBuffer | null> {
    try {
      // 使用 PCS 直接下载接口，通过路径下载，不需要 fsid
      const url = `https://pcs.baidu.com/rest/2.0/pcs/file?method=download&access_token=${this.config.accessToken}&path=${encodeURIComponent(remotePath)}`;
      const res = await requestUrl({
        url,
        method: "GET",
        headers: { "User-Agent": "pan.baidu.com" },
        throw: false,
      });

      if (res.status !== 200) {
        console.error("[BaiduPan] downloadFile failed:", res.status, res.text?.slice(0, 200));
        return null;
      }
      return res.arrayBuffer;
    } catch (e) {
      console.error("[BaiduPan] downloadFile exception:", e);
      return null;
    }
  }

  // ── 删除 ───────────────────────────────────────────────────

  async deleteFile(remotePath: string): Promise<boolean> {
    try {
      const body = new URLSearchParams({
        filelist: JSON.stringify([remotePath]),
      }).toString();

      const res = await requestUrl({
        url: `${PAN_API}/file?method=filemanager&opera=delete&access_token=${this.config.accessToken}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "pan.baidu.com" },
        body,
        throw: false,
      });
      return res.status === 200 && res.json.errno === 0;
    } catch {
      return false;
    }
  }

  // ── 工具方法 ───────────────────────────────────────────────

  private splitChunks(bytes: Uint8Array): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      // slice() 返回独立副本，避免共享 buffer 问题
      chunks.push(bytes.slice(offset, offset + CHUNK_SIZE));
    }
    // 空文件也需要一个空块
    if (chunks.length === 0) chunks.push(new Uint8Array(0));
    return chunks;
  }
}
