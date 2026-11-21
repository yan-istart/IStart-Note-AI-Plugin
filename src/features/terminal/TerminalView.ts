import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type DeepSeekPlugin from "../../main";
import { bindSidebarViewport } from "../../ui/SidebarViewport";
import { WORKBENCH_VIEWS } from "../workbench/WorkbenchController";
import { renderWorkbenchNav } from "../workbench/WorkbenchNav";
import { openTerminalAt, resolveTerminalTarget } from "./launcher";
import { TerminalEnvironment, type EnvProgress } from "./environment";
import { TerminalSession } from "./session";
import { imeCommitAction, type RecentTerminalData } from "./ime";
import type { TerminalSettings } from "./types";

export const TERMINAL_VIEW_TYPE = WORKBENCH_VIEWS.terminal;

/** Workbench "终端" page: embedded xterm console backed by the local terminal service (desktop only). */
export class TerminalView extends ItemView {
  private cleanupViewport?: () => void;
  private body!: HTMLElement;
  private toolbar!: HTMLElement;
  private statusEl!: HTMLElement;
  private progressEl!: HTMLElement;
  private progressLabel!: HTMLElement;
  private progressBar!: HTMLElement;
  private termBox!: HTMLElement;
  private directory!: HTMLSelectElement;
  private term?: Terminal;
  private fit?: FitAddon;
  private session?: TerminalSession;
  private envBusy = false;
  private observer?: ResizeObserver;
  private stateText = "未连接";
  private recentTermData: RecentTerminalData[] = [];

  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) {
    super(leaf);
  }

  private get environment(): TerminalEnvironment { return this.plugin.terminal; }

  getViewType(): string { return TERMINAL_VIEW_TYPE; }
  getDisplayText(): string { return "终端"; }
  getIcon(): string { return "terminal"; }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshDirectory()));
    const container = this.contentEl;
    container.empty();
    container.addClass("istart-terminal-root");
    renderWorkbenchNav(container, this.plugin, "terminal");
    this.body = container.createDiv({ cls: "istart-workbench-body" });

    this.body.createEl("h4", { text: "终端" });
    this.body.createEl("p", {
      text: "内嵌控制台:直接在当前笔记目录或 Vault 根运行 opencode、codex 等命令行工具。首次使用会自动检查环境并安装终端服务(进度见下方),安装过程透明、可复用已有环境。",
      cls: "istart-terminal-note",
    });

    this.toolbar = this.body.createDiv({ cls: "istart-terminal-toolbar" });
    const startButton = this.toolbar.createEl("button", { text: "启动终端", attr: { type: "button" } });
    startButton.addClass("mod-cta");
    startButton.addEventListener("click", () => { void this.start(); });
    const systemButton = this.toolbar.createEl("button", { text: "打开系统终端", attr: { type: "button" } });
    systemButton.addEventListener("click", () => { void openTerminalAt(this.plugin, "default"); });
    const settingsButton = this.toolbar.createEl("button", { text: "设置", attr: { type: "button" } });
    settingsButton.addEventListener("click", () => this.plugin.openTerminalSettings());
    const directoryLabel = this.toolbar.createEl("label", { cls: "istart-terminal-directory" });
    directoryLabel.createSpan({ text: "目录" });
    this.directory = directoryLabel.createEl("select", { attr: { "aria-label": "终端工作目录" } });
    this.directory.createEl("option", { value: "note", text: "当前笔记所在目录" });
    this.directory.createEl("option", { value: "vault", text: "Vault 根目录" });
    this.refreshDirectory();
    this.directory.addEventListener("change", () => {
      this.plugin.settings.terminal.defaultLocation = this.directory.value as TerminalSettings["defaultLocation"];
      void this.plugin.saveSettings();
      if (this.session) void this.connect();
    });

    this.progressEl = this.body.createDiv({ cls: "istart-terminal-progress" });
    this.progressEl.hide();
    this.progressLabel = this.progressEl.createSpan({ cls: "istart-terminal-progress-label" });
    const progressTrack = this.progressEl.createDiv({ cls: "istart-terminal-progress-track" });
    this.progressBar = progressTrack.createDiv({ cls: "istart-terminal-progress-bar" });

    this.statusEl = this.body.createDiv({ cls: "istart-terminal-status", attr: { role: "status", "aria-live": "polite" } });
    this.setStatusText("等待启动");
    this.termBox = this.body.createDiv({ cls: "istart-terminal-xterm" });

    this.observer = new ResizeObserver(() => {
      if (!this.fit || !this.term) return;
      try {
        this.fit.fit();
        this.session?.resize(this.term.cols, this.term.rows);
      } catch { /* Terminal not ready yet. */ }
    });
    this.observer.observe(this.termBox);

    this.cleanupViewport = bindSidebarViewport(container);
    void this.start();
  }

  async onClose(): Promise<void> {
    this.observer?.disconnect();
    this.session?.close();
    this.session = undefined;
    try { this.term?.dispose(); } catch { /* Already disposed. */ }
    this.term = undefined;
    this.cleanupViewport?.();
    this.contentEl.empty();
  }

  private setStatusText(text: string): void {
    this.stateText = text;
    if (this.statusEl) this.statusEl.setText(`状态:${text}`);
  }

  private renderProgress(progress: EnvProgress): void {
    this.progressEl.show();
    this.progressLabel.setText(progress.detail);
    this.progressBar.style.width = `${Math.min(100, Math.max(0, progress.percent))}%`;
    if (progress.step === "ready" || progress.step === "failed") this.progressEl.hide();
  }

  private refreshDirectory(): void {
    if (!this.directory) return;
    this.directory.value = this.plugin.settings.terminal.defaultLocation;
  }

  private async start(): Promise<void> {
    if (this.envBusy) return;
    this.envBusy = true;
    try {
      let status = await this.environment.status();
      if (status.state === "missing-node" || status.state === "outdated-node") {
        this.setStatusText(status.state === "missing-node" ? "未检测到 Node.js 24+" : `需要 Node.js 24+(当前 ${status.nodeVersion})`);
        new Notice(status.state === "missing-node"
          ? "未检测到 Node.js 24+。已安装 Node.js 时,可在设置 → 终端 → Node.js 路径中填写绝对路径;也可使用「打开系统终端」。"
          : `内嵌终端需要 Node.js 24+,当前为 ${status.nodeVersion}。请升级 Node.js,或使用「打开系统终端」。`);
        return;
      }
      if (status.state === "ready") {
        await this.connect();
        return;
      }
      status = await this.environment.ensure(progress => this.renderProgress(progress));
      if (status.state === "ready") await this.connect();
      else this.setStatusText(`环境失败:${status.error ?? "未知错误"}`);
    } catch (error) {
      this.setStatusText(`环境失败:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.envBusy = false;
    }
  }

  private async connect(): Promise<void> {
    this.session?.close();
    try { this.term?.dispose(); } catch { /* First open. */ }
    const target = resolveTerminalTarget(this.plugin, this.plugin.settings.terminal, "default");
    if (!target) {
      this.setStatusText("无法获取 Vault 目录");
      return;
    }
    const config = await this.environment.config();
    const dark = this.contentEl.ownerDocument.body.hasClass("theme-dark");
    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 4000,
      theme: dark
        ? { background: "#1e1e1e", foreground: "#d4d4d4", cursor: "#d4d4d4" }
        : { background: "#ffffff", foreground: "#333333", cursor: "#333333" },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(this.termBox);
    this.fit.fit();
    this.recentTermData = [];
    this.installImeGuard();
    this.setStatusText(`连接 ${target.label} …`);
    this.session = new TerminalSession(
      { port: config.port, token: config.token, cwd: target.directory, cols: this.term.cols, rows: this.term.rows },
      {
        onData: data => { try { this.term?.write(data); } catch { /* Terminal closed. */ } },
        onExit: code => this.setStatusText(`会话已退出(代码 ${code}) · 点击「启动终端」重新开始`),
        onState: (state, message) => {
          if (state === "ready") this.setStatusText(`已连接 · ${target.directory}`);
          else if (state === "connecting") this.setStatusText("连接中…");
          else if (state === "error") this.setStatusText(`连接失败:${message ?? "未知错误"}`);
          else if (state === "closed" && !this.stateText.startsWith("会话已退出")) this.setStatusText("连接已断开 · 点击「启动终端」重连");
        },
      },
    );
    this.term.onData(data => {
      this.recentTermData.push({ text: data, at: Date.now() });
      if (this.recentTermData.length > 12) this.recentTermData.splice(0, this.recentTermData.length - 12);
      this.session?.input(data);
    });
    this.session.open();
  }

  /**
   * IME guard for xterm issues #5778/#6140: when a keydown finalizes the
   * composition, xterm forwards the text immediately and again from its
   * deferred compositionend handler. Forward the commit exactly once and
   * cancel the deferred duplicate.
   */
  private installImeGuard(): void {
    const textarea = this.term?.textarea;
    if (!textarea) return;
    textarea.addEventListener("compositionend", event => {
      const data = event.data;
      if (!data || !this.session) return;
      if (imeCommitAction(this.recentTermData, data, Date.now()) === "send") this.session.input(data);
      // This capture listener runs before xterm's compositionend handler, which
      // schedules its duplicate at setTimeout(0). Our timeout was registered
      // first, so it runs first and cancels the scheduled send.
      window.setTimeout(() => {
        const helper = (this.term as unknown as { _core?: { _compositionHelper?: { _isSendingComposition?: boolean } } })._core?._compositionHelper;
        if (helper) helper._isSendingComposition = false;
      }, 0);
    }, true);
  }
}
