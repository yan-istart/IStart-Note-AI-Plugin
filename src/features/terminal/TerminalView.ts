import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { bindSidebarViewport } from "../../ui/SidebarViewport";
import { WORKBENCH_VIEWS } from "../workbench/WorkbenchController";
import { renderWorkbenchNav } from "../workbench/WorkbenchNav";
import { openTerminalAt, resolveTerminalTarget } from "./launcher";
import type { TerminalSettings } from "./types";

export const TERMINAL_VIEW_TYPE = WORKBENCH_VIEWS.terminal;

/** Workbench "终端" page: launcher panel for the system terminal (desktop only). */
export class TerminalView extends ItemView {
  private cleanupViewport?: () => void;
  private targetEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: DeepSeekPlugin) { super(leaf); }

  getViewType(): string { return TERMINAL_VIEW_TYPE; }
  getDisplayText(): string { return "终端"; }
  getIcon(): string { return "terminal"; }

  async onOpen(): Promise<void> {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateTarget()));
    this.render();
    this.cleanupViewport = bindSidebarViewport(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.cleanupViewport?.();
    this.contentEl.empty();
  }

  private button(root: HTMLElement, text: string, work: () => Promise<void>): HTMLButtonElement {
    const button = root.createEl("button", { text, attr: { type: "button" } });
    button.addEventListener("click", () => { void work(); });
    return button;
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("istart-terminal-root");
    renderWorkbenchNav(container, this.plugin, "terminal");
    const body = container.createDiv({ cls: "istart-workbench-body" });

    body.createEl("h4", { text: "终端" });
    body.createEl("p", {
      text: "在系统终端中打开目录，快捷使用 opencode、codex 等命令行工具。插件只负责定位目录，不在终端中执行命令。",
      cls: "istart-terminal-note",
    });

    const targetBox = body.createDiv({ cls: "istart-terminal-target" });
    targetBox.createSpan({ text: "当前定位", cls: "istart-terminal-target-label" });
    this.targetEl = targetBox.createEl("code", { cls: "istart-terminal-path", attr: { role: "status" } });

    const actions = body.createDiv({ cls: "istart-terminal-actions" });
    this.button(actions, "在当前笔记所在目录打开", () => openTerminalAt(this.plugin, "note")).addClass("mod-cta");
    this.button(actions, "在 Vault 打开", () => openTerminalAt(this.plugin, "vault"));

    new Setting(body)
      .setName("默认打开位置")
      .setDesc("决定命令「在终端打开」使用的目录；无活动笔记时回退 Vault 根。")
      .addDropdown(dropdown => dropdown
        .addOption("note", "当前笔记所在目录")
        .addOption("vault", "总是 Vault 根")
        .setValue(this.plugin.settings.terminal.defaultLocation)
        .onChange(async value => {
          this.plugin.settings.terminal.defaultLocation = value as TerminalSettings["defaultLocation"];
          await this.plugin.saveSettings();
          this.updateTarget();
        }));

    new Setting(body)
      .setName("终端设置")
      .setDesc("macOS 终端应用与 Linux 终端命令模板在设置 → 终端中管理。")
      .addButton(button => button.setButtonText("打开设置").onClick(() => this.plugin.openTerminalSettings()));

    this.updateTarget();
  }

  private updateTarget(): void {
    const target = resolveTerminalTarget(this.plugin, this.plugin.settings.terminal, "default");
    if (this.targetEl) this.targetEl.setText(target ? target.directory : "桌面端不可用");
  }
}
