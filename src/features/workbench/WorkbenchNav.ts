import { Notice, setIcon } from "obsidian";
import type DeepSeekPlugin from "../../main";
import type { WorkbenchSection } from "./WorkbenchController";

/** Shared navigation stays available in every workbench section. */
export function renderWorkbenchNav(root: HTMLElement, plugin: DeepSeekPlugin, active: WorkbenchSection): void {
  const nav = root.createEl("nav", { cls: "istart-workbench-nav", attr: { "aria-label": "IStart 工作台" } });
  const heading = nav.createDiv({ cls: "istart-workbench-heading" });
  heading.createEl("strong", { text: "IStart 工作台" });
  const tabs = nav.createDiv({ cls: "istart-workbench-tabs" });
  const sections: { id: WorkbenchSection; label: string; icon: string; open: () => Promise<unknown> }[] = [
    { id: "assistant", label: "AI 助手", icon: "messages-square", open: () => plugin.activateAgentView() },
    { id: "annotations", label: "批注", icon: "highlighter", open: () => plugin.activateAnnotationView() },
    { id: "sync", label: "数据同步", icon: "cloud", open: () => plugin.activateSyncView() },
  ];
  for (const section of sections) {
    const button = tabs.createEl("button", {
      cls: `istart-workbench-tab${section.id === active ? " is-active" : ""}`,
      attr: { type: "button", "aria-pressed": String(section.id === active) },
    });
    setIcon(button.createSpan({ attr: { "aria-hidden": "true" } }), section.icon);
    button.createSpan({ text: section.label });
    button.addEventListener("click", () => {
      if (section.id === active) return;
      void section.open().catch(error => new Notice(`无法切换工作台：${error instanceof Error ? error.message : String(error)}`));
    });
  }
}
