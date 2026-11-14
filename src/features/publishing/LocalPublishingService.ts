import { Platform } from "obsidian";
import type { PublishingDeviceConfig } from "./DeviceConfig";

declare function require(id: string): unknown;
declare const ISTART_PUBLISHING_GATEWAY: string;
declare const ISTART_PUBLISHING_WORKER: string;

/** Only this desktop module can load Node. Its runtime is embedded in the normal main.js release. */
export class LocalPublishingService {
  private process: import("child_process").ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private disposed = false;
  status = "本地服务尚未启动";
  constructor(private config: PublishingDeviceConfig) {}
  get running(): boolean { return !!this.process && this.process.exitCode === null && !this.process.killed; }
  private modules() {
    if (!Platform.isDesktop || typeof require === "undefined") throw new Error("本地分发服务仅支持桌面端");
    return { fs: require("fs") as typeof import("fs"), path: require("path") as typeof import("path"),
      os: require("os") as typeof import("os"), child: require("child_process") as typeof import("child_process"),
      environment: require("process") as typeof import("process") };
  }
  private async findNode(): Promise<string> {
    const { child, fs, environment } = this.modules();
    const candidates = this.config.value.nodePath ? [this.config.value.nodePath] : ["node", ...(environment.platform === "darwin" ? ["/opt/homebrew/bin/node", "/usr/local/bin/node"] : []), ...(environment.platform === "win32" ? ["C:\\Program Files\\nodejs\\node.exe"] : [])];
    for (const command of candidates) {
      if (command !== "node" && !fs.existsSync(command)) continue;
      const valid = await new Promise<boolean>(resolve => {
        child.execFile(command, ["--version"], { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(!error && Number(/^v(\d+)/.exec(stdout)?.[1] ?? 0) >= 22));
      });
      if (valid) return command;
    }
    throw new Error("未找到 Node.js 22 或更高版本，请安装后重试，或填写 Node 可执行文件路径");
  }
  async start(): Promise<void> {
    if (this.disposed) throw new Error("插件已关闭");
    if (this.running) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try { await this.starting; } finally { this.starting = null; }
  }
  private async launch(): Promise<void> {
    const node = await this.findNode();
    if (this.disposed) throw new Error("插件已关闭");
    const { fs, path, os, child, environment } = this.modules();
    const directory = path.join(os.homedir(), ".istart-publishing", this.config.value.id);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(directory, "publishing-service.cjs"), ISTART_PUBLISHING_GATEWAY, { mode: 0o600 });
    fs.writeFileSync(path.join(directory, "publishing-mcp.cjs"), ISTART_PUBLISHING_WORKER, { mode: 0o600 });
    if (!this.config.token) this.config.token = crypto.randomUUID() + crypto.randomUUID();
    if (!this.config.extensionToken) this.config.extensionToken = crypto.randomUUID() + crypto.randomUUID();
    this.config.save();
    const process = child.spawn(node, [path.join(directory, "publishing-service.cjs")], {
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...environment.env, PUBLISHING_TOKEN: this.config.token, EXTENSION_TOKEN: this.config.extensionToken,
        PUBLISHING_PORT: String(this.config.value.port), BRIDGE_PORT: String(this.config.value.bridgePort),
        PUBLISHING_HOST: "127.0.0.1", BRIDGE_HOST: "127.0.0.1", PUBLISHING_DATA: path.join(directory, "jobs") },
    });
    this.process = process; this.status = "正在启动本地服务";
    process.stderr?.on("data", () => { /* Drain bounded, fixed runtime diagnostics; never echo tokens. */ });
    process.once("exit", () => { if (this.process === process) { this.process = null; this.status = "本地服务已停止"; } });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.stop(); reject(new Error("本地服务启动超时，请检查端口是否被占用")); }, 15000);
      process.once("error", () => { window.clearTimeout(timer); if (this.process === process) this.process = null; this.status = "本地服务启动失败"; reject(new Error("无法启动服务，请检查 Node 路径")); });
      process.once("exit", () => { window.clearTimeout(timer); reject(new Error("本地服务启动失败，请检查服务端口和扩展端口是否被占用")); });
      process.stdout?.on("data", (chunk: Uint8Array) => {
        if (!new TextDecoder().decode(chunk).includes("ISTART_PUBLISHING_READY")) return;
        window.clearTimeout(timer); this.status = "本地服务已启动"; resolve();
      });
    });
  }
  stop(): void { this.process?.kill("SIGTERM"); this.status = "正在停止本地服务"; }
  async restart(): Promise<void> {
    const process = this.process;
    if (process && this.running) await new Promise<void>(resolve => {
      process.once("exit", () => resolve()); this.stop();
    });
    await this.start();
  }
  dispose(): void { this.disposed = true; this.stop(); }
}
