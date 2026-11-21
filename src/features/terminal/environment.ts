import { Platform, requestUrl } from "obsidian";
import { unzipSync } from "fflate";
import type { TerminalSettings } from "./types";

/** The bundled PTY service ships node-pty prebuilds for the current Node LTS. */
export const MIN_NODE_MAJOR = 24;
export const TERMINAL_RELEASE_REPO = "yan-istart/IStart-Note-AI-Plugin";
export const SERVICE_VERSION_MISMATCH = "service-version-mismatch";

export type EnvStep = "idle" | "node" | "download" | "extract" | "start" | "health" | "ready" | "failed";
export type EnvState = "missing-node" | "outdated-node" | "no-service" | "stale-service" | "stopped" | "starting" | "ready" | "failed";

export interface EnvProgress {
  step: EnvStep;
  detail: string;
  /** 0-100, meaningful for downloads. */
  percent: number;
}

export interface EnvStatus {
  state: EnvState;
  nodeVersion?: string;
  serviceVersion?: string;
  port: number;
  error?: string;
}

export interface ServiceConfig {
  port: number;
  token: string;
}

/** Filesystem/process/network surface, injected for tests. Desktop only in production. */
export interface TerminalIo {
  exec(command: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
  spawnDetached(command: string, args: string[], options: { cwd: string; env: Record<string, string | undefined> }): void;
  homeDir(): string;
  join(...parts: string[]): string;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  listDir(path: string): Promise<string[]>;
  chmod(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  download(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array>;
  getJson(url: string): Promise<{ status: number; body: unknown } | null>;
  shutdown(url: string, token: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  randomToken(): string;
}

function parseMajor(version: string): number {
  const match = /^v?(\d+)/.exec(version.trim());
  return match ? Number(match[1]) : 0;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface NodeInfo {
  /** Binary path used for checks and for spawning the service. */
  path: string;
  version: string;
}

type BundleInfo =
  | { kind: "installed"; script: string; cwd: string }
  | { kind: "zip"; zip: string }
  | { kind: "inline"; script: string; cwd: string }
  | { kind: "none" };

/** Common install locations probed when the GUI PATH does not include Node.js. */
function nodeProbePaths(home: string): string[] {
  if (Platform.isMacOS) return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
  if (Platform.isWin) {
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFiles86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    return [`${programFiles}\\nodejs\\node.exe`, `${programFiles86}\\nodejs\\node.exe`];
  }
  return ["/usr/local/bin/node", "/usr/bin/node", `${home}/.local/bin/node`];
}

/**
 * Supervises the local terminal service: checks the Node.js environment,
 * downloads/installs the service bundle once per plugin version, reuses any
 * healthy instance, and starts it transparently when needed.
 */
export class TerminalEnvironment {
  constructor(
    private io: TerminalIo,
    private version: string,
    private settings: () => TerminalSettings,
    private pluginDir?: () => string,
  ) {}

  private root(): string { return this.io.join(this.io.homeDir(), ".istart-terminal"); }
  private serviceDir(): string { return this.io.join(this.root(), this.version); }
  private configPath(): string { return this.io.join(this.root(), "config.json"); }
  private healthUrl(port: number): string { return `http://127.0.0.1:${port}/health`; }
  private shutdownUrl(port: number): string { return `http://127.0.0.1:${port}/shutdown`; }
  private releaseAssetUrl(): string {
    return `https://github.com/${TERMINAL_RELEASE_REPO}/releases/download/${this.version}/terminal-service-${this.version}.zip`;
  }

  /** Path of a service zip shipped next to the plugin files, if the plugin dir is known. */
  private async localBundleZip(): Promise<string | null> {
    const dir = this.pluginDir?.();
    if (!dir) return null;
    try {
      const exact = this.io.join(dir, `terminal-service-${this.version}.zip`);
      if (await this.io.exists(exact)) return exact;
      // Accept any locally built service zip when the exact version name is absent.
      const entries = await this.io.listDir(dir);
      const candidates = entries
        .filter(name => /^terminal-service-.+\.zip$/.test(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const name of candidates) {
        const path = this.io.join(dir, name);
        if (await this.io.exists(path)) return path;
      }
    } catch {
      /* Fall through to the download path. */
    }
    return null;
  }

  /**
   * Locate the service bundle. Priority: installed copy under ~/.istart-terminal,
   * a zip shipped in the plugin folder, or the service extracted directly into
   * the plugin folder (handy for local dev builds).
   */
  private async resolveBundle(): Promise<BundleInfo> {
    const installed = this.io.join(this.serviceDir(), "terminal-service.cjs");
    if (await this.io.exists(installed)) return { kind: "installed", script: installed, cwd: this.serviceDir() };
    const dir = this.pluginDir?.();
    if (dir) {
      const zip = await this.localBundleZip();
      if (zip) return { kind: "zip", zip };
      const inline = this.io.join(dir, "terminal-service.cjs");
      if (await this.io.exists(inline)) return { kind: "inline", script: inline, cwd: dir };
    }
    return { kind: "none" };
  }

  /** Diagnostic paths appended to failures so users can see what was checked. */
  private localHint(): string {
    const parts = [this.serviceDir()];
    const dir = this.pluginDir?.();
    if (dir) parts.push(`${dir} 下的 terminal-service-${this.version}.zip`);
    return `。已检查:${parts.join("、")}`;
  }

  /** Quick environment survey for UI display; performs no downloads. */
  async status(): Promise<EnvStatus> {
    const port = this.settings().port;
    const node = await this.resolveNode();
    if (!node) return { state: "missing-node", port };
    if (parseMajor(node.version) < MIN_NODE_MAJOR) return { state: "outdated-node", nodeVersion: node.version, port };
    const health = await this.io.getJson(this.healthUrl(port));
    if (health && health.status === 200) {
      const serviceVersion = (health.body as { version?: string })?.version ?? "";
      return serviceVersion === this.version
        ? { state: "ready", nodeVersion: node.version, serviceVersion, port }
        : { state: "stale-service", nodeVersion: node.version, serviceVersion, port };
    }
    const bundle = await this.resolveBundle();
    const deployed = bundle.kind !== "none";
    return deployed ? { state: "stopped", nodeVersion: node.version, port } : { state: "no-service", nodeVersion: node.version, port };
  }

  /**
   * Locate a usable Node.js binary. GUI apps on macOS do not inherit the
   * terminal PATH, so detection falls back to login-shell resolution and
   * common install locations before giving up.
   */
  async resolveNode(): Promise<NodeInfo | null> {
    for (const candidate of await this.nodeCandidates()) {
      const result = await this.io.exec(candidate, ["--version"]);
      if (result.ok && parseMajor(result.stdout) > 0) return { path: candidate, version: result.stdout.trim() };
    }
    return null;
  }

  private async nodeCandidates(): Promise<string[]> {
    const found: string[] = [];
    const push = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (trimmed && !found.includes(trimmed)) found.push(trimmed);
    };
    push(this.settings().nodePath);
    // 1. Direct PATH lookup (works when the app inherits a full PATH).
    const direct = await this.io.exec("node", ["--version"]);
    if (direct.ok) push("node");
    // 2. Common install locations.
    const home = this.io.homeDir();
    for (const candidate of nodeProbePaths(home)) {
      if (await this.io.exists(candidate)) push(candidate);
    }
    // 3. Login-shell resolution picks up nvm/fnm/volta paths (macOS/Linux).
    push(await this.shellNodePath());
    return found;
  }

  private async shellNodePath(): Promise<string | null> {
    if (Platform.isWin) return null;
    const shell = process.env.SHELL?.trim() || "/bin/bash";
    try {
      const result = await this.io.exec(shell, ["-i", "-l", "-c", "echo ISTART_NODE_BEGIN; command -v node; echo ISTART_NODE_END"]);
      if (!result.ok) return null;
      const match = /ISTART_NODE_BEGIN\s*([\s\S]*?)\s*ISTART_NODE_END/.exec(result.stdout);
      const path = match?.[1]?.trim();
      return path || null;
    } catch {
      return null;
    }
  }

  /**
   * Full transparent chain: check Node → reuse a healthy service → download
   * (with progress) and install when missing/stale → start → wait for health.
   */
  async ensure(onProgress: (progress: EnvProgress) => void): Promise<EnvStatus> {
    const report = (step: EnvStep, detail: string, percent = 0) => onProgress({ step, detail, percent });
    try {
      report("node", "检查 Node.js 环境…");
      const node = await this.resolveNode();
      if (!node) {
        return { state: "missing-node", port: this.settings().port, error: "未检测到 Node.js。请安装 Node.js 24+，或在设置 → 终端中填写 Node.js 路径；也可使用「打开系统终端」。" };
      }
      const nodeVersion = node.version;
      if (parseMajor(nodeVersion) < MIN_NODE_MAJOR) {
        return { state: "outdated-node", nodeVersion, port: this.settings().port, error: `内嵌终端服务需要 Node.js ${MIN_NODE_MAJOR}+，当前为 ${nodeVersion}。请升级后重试，或使用「打开系统终端」。` };
      }

      const config = await this.ensureConfig();
      const port = config.port;
      const health = await this.io.getJson(this.healthUrl(port));
      const serviceVersion = health?.status === 200 ? (health.body as { version?: string })?.version ?? "" : "";

      // Reuse a healthy instance of the same version.
      if (health && health.status === 200 && serviceVersion === this.version) {
        report("ready", "终端服务已运行，直接复用");
        return { state: "ready", nodeVersion, serviceVersion, port };
      }
      // Stop an outdated running instance before deploying the new one.
      if (health && health.status === 200) {
        report("start", "停止旧版终端服务…");
        await this.io.shutdown(this.shutdownUrl(port), config.token);
        await this.io.sleep(800);
      }

      let bundle = await this.resolveBundle();
      if (bundle.kind === "zip") {
        report("extract", "安装插件目录自带的终端服务包…", 100);
        await this.installBundle(await this.io.readBinary(bundle.zip));
        this.settings().serviceVersion = this.version;
        bundle = { kind: "installed", script: this.io.join(this.serviceDir(), "terminal-service.cjs"), cwd: this.serviceDir() };
      } else if (bundle.kind === "none") {
        report("download", "下载终端服务…", 0);
        const data = await this.io.download(this.releaseAssetUrl(), (loaded, total) => {
          report("download", total ? `下载终端服务… ${formatMB(loaded)} / ${formatMB(total)}` : `下载终端服务… ${formatMB(loaded)}`, total ? Math.round((loaded / total) * 100) : 0);
        });
        report("extract", "安装终端服务…", 100);
        await this.installBundle(data);
        this.settings().serviceVersion = this.version;
        bundle = { kind: "installed", script: this.io.join(this.serviceDir(), "terminal-service.cjs"), cwd: this.serviceDir() };
      }

      // Repair permissions for pre-existing installs and inline bundles.
      await this.prepareBundle(bundle.cwd);
      report("start", "启动终端服务…");
      this.io.spawnDetached(node.path, [bundle.script], {
        cwd: bundle.cwd,
        env: { ISTART_TERMINAL_TOKEN: config.token, ISTART_TERMINAL_PORT: String(port) },
      });

      report("health", "等待终端服务就绪…");
      for (let attempt = 0; attempt < 20; attempt++) {
        await this.io.sleep(300);
        const ready = await this.io.getJson(this.healthUrl(port));
        if (ready?.status === 200) {
          report("ready", "终端服务已就绪");
          return { state: "ready", nodeVersion, serviceVersion: this.version, port };
        }
      }
      return { state: "failed", nodeVersion, port, error: "终端服务启动超时。可重试，或使用「打开系统终端」。" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { state: "failed", port: this.settings().port, error: `${message}${this.localHint()}` };
    }
  }

  /** Read the shared service config (port + token), creating it on first use. */
  async config(): Promise<ServiceConfig> {
    return this.ensureConfig();
  }

  async stop(): Promise<void> {
    const config = await this.ensureConfig();
    await this.io.shutdown(this.shutdownUrl(config.port), config.token);
  }

  private async ensureConfig(): Promise<ServiceConfig> {
    try {
      const saved = JSON.parse(await this.io.readText(this.configPath())) as Partial<ServiceConfig>;
      if (typeof saved?.port === "number" && typeof saved?.token === "string" && saved.token.length >= 16) {
        return { port: saved.port, token: saved.token };
      }
    } catch {
      // First use or unreadable config; create a fresh one below.
    }
    const config: ServiceConfig = { port: this.settings().port, token: this.io.randomToken() };
    await this.io.mkdir(this.root());
    await this.io.writeText(this.configPath(), JSON.stringify(config));
    return config;
  }

  private async installBundle(zip: Uint8Array): Promise<void> {
    const staging = this.io.join(this.root(), `.${this.version}-staging`);
    await this.io.mkdir(this.root());
    await this.io.remove(staging);
    const entries = unzipSync(zip);
    for (const [path, data] of Object.entries(entries)) {
      const target = this.io.join(staging, ...path.split("/"));
      await this.io.mkdir(this.io.join(target, ".."));
      await this.io.writeBinary(target, data);
    }
    // Replace any previously installed bundle of this version.
    await this.io.remove(this.serviceDir());
    await this.io.rename(staging, this.serviceDir());
    await this.prepareBundle(this.serviceDir());
  }

  /**
   * fflate extraction does not preserve Unix permissions; node-pty requires its
   * spawn-helper to be executable on macOS/Linux.
   */
  private async prepareBundle(dir: string): Promise<void> {
    if (Platform.isWin) return;
    const helper = this.io.join(dir, "node_modules", "@homebridge", "node-pty-prebuilt-multiarch", "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    if (!(await this.io.exists(helper))) return;
    try { await this.io.chmod(helper, 0o755); } catch { /* Best effort; spawn reports the real error. */ }
  }

  /**
   * Install a terminal service bundle from a local zip, so local testing and
   * offline setups work without a published release asset.
   */
  async installFromZip(zip: Uint8Array): Promise<void> {
    await this.io.remove(this.serviceDir());
    await this.installBundle(zip);
    this.settings().serviceVersion = this.version;
  }
}

/** Production Io backed by desktop Node built-ins; every call is desktop-gated. */
export function systemTerminalIo(): TerminalIo {
  const guard = () => {
    if (!Platform.isDesktopApp) throw new Error("内嵌终端仅支持桌面端");
  };
  const node = <T>(name: string): T => {
    guard();
    return require(name) as T;
  };
  return {
    exec(command, args) {
      guard();
      const cp = node<typeof import("child_process")>("child_process");
      return new Promise(resolve => {
        cp.execFile(command, args, { timeout: 8000 }, (error, stdout, stderr) => {
          resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        });
      });
    },
    spawnDetached(command, args, options) {
      guard();
      const cp = node<typeof import("child_process")>("child_process");
      const child = cp.spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    },
    homeDir() {
      const os = node<typeof import("os")>("os");
      return os.homedir();
    },
    join(...parts) {
      const path = node<typeof import("path")>("path");
      return path.join(...parts);
    },
    async mkdir(path) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.mkdir(path, { recursive: true });
    },
    async exists(path) {
      const fs = node<typeof import("fs")>("fs");
      try { await fs.promises.access(path); return true; } catch { return false; }
    },
    async readText(path) {
      const fs = node<typeof import("fs")>("fs");
      return fs.promises.readFile(path, "utf8");
    },
    async writeText(path, text) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.writeFile(path, text, { mode: 0o600 });
    },
    async writeBinary(path, data) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.writeFile(path, data);
    },
    async readBinary(path) {
      const fs = node<typeof import("fs")>("fs");
      return new Uint8Array(await fs.promises.readFile(path));
    },
    async listDir(path) {
      const fs = node<typeof import("fs")>("fs");
      try { return await fs.promises.readdir(path); } catch { return []; }
    },
    async chmod(path, mode) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.chmod(path, mode);
    },
    async rename(from, to) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.rename(from, to);
    },
    async remove(path) {
      const fs = node<typeof import("fs")>("fs");
      await fs.promises.rm(path, { recursive: true, force: true });
    },
    async download(url, onProgress) {
      guard();
      // Obsidian's requestUrl goes through the Electron network stack, so it
      // follows redirects and is not subject to renderer CSP/CORS limits.
      try {
        const response = await requestUrl({ url, method: "GET", contentType: "application/octet-stream" });
        const buffer = response.arrayBuffer;
        if (buffer instanceof ArrayBuffer) {
          onProgress(buffer.byteLength, buffer.byteLength);
          return new Uint8Array(buffer);
        }
      } catch {
        // Fall back to a streaming fetch with progress below.
      }
      let response: Response;
      try {
        response = await window.fetch(url);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法连接 GitHub 下载终端服务包:${detail}。请检查网络或代理后重试,或使用「打开系统终端」。`);
      }
      if (response.status === 404) {
        throw new Error("当前插件版本的 GitHub Release 未包含终端服务包(HTTP 404)。可重新发布该版本(CI 会自动上传),或在设置 → 终端中「从本地 zip 安装」离线安装,或使用「打开系统终端」。");
      }
      if (!response.ok) {
        throw new Error(`终端服务下载失败(HTTP ${response.status})。请检查网络后重试,或使用「打开系统终端」。`);
      }
      const total = Number(response.headers.get("content-length")) || 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("下载响应不可读");
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { chunks.push(value); loaded += value.byteLength; onProgress(loaded, total); }
      }
      const merged = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
      return merged;
    },
    async getJson(url) {
      guard();
      try {
        const response = await requestUrl({ url, method: "GET" });
        return { status: response.status, body: response.json };
      } catch {
        return null;
      }
    },
    async shutdown(url, token) {
      guard();
      try {
        await requestUrl({ url, method: "POST", headers: { Authorization: `Bearer ${token}` } });
        return true;
      } catch {
        return false;
      }
    },
    sleep(ms) { return new Promise(resolve => window.setTimeout(resolve, ms)); },
    randomToken() {
      guard();
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}
