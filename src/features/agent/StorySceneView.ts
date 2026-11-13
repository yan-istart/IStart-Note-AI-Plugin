import type { AgentMessage, AgentSession, LiveStoryScene, StoryBlock } from "../../core/agent/types";
import { serializeStory, storyName } from "../../core/agent/StoryContent";
import type { AgentController } from "./AgentController";

interface BlockNode { root: HTMLElement; text: Text; notice: HTMLElement; controls: HTMLElement }
export interface StorySceneActions { perform(action: () => unknown): void; confirm(): void; copy(text: string): void }

/** Stable block nodes preserve selection, scroll position and exact text while tokens arrive. */
export class StorySceneView {
  private scene: LiveStoryScene;
  private status: HTMLElement;
  private content: HTMLElement;
  private toolbar: HTMLElement;
  private blocks = new Map<string, BlockNode>();
  private mode: "dialogue" | "prose" = "dialogue";
  private dialogueButton: HTMLButtonElement;
  private proseButton: HTMLButtonElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private target: HTMLSelectElement;
  private warning: HTMLElement;
  private evolution: HTMLElement;
  private evolutionText: HTMLElement;
  private details: HTMLDetailsElement;
  private diagnostics: HTMLElement;
  private diagnosticsKey = "";
  private currentMessage: AgentMessage;
  constructor(readonly root: HTMLElement, private session: AgentSession, message: AgentMessage, private controller: AgentController, private actions: StorySceneActions) {
    this.currentMessage = message; this.scene = message.story as LiveStoryScene;
    root.addClass("istart-story-scene");
    const header = root.createDiv({ cls: "istart-story-header" });
    this.status = header.createDiv({ cls: "istart-agent-muted", attr: { role: "status", "aria-live": "polite" } });
    const views = header.createDiv({ cls: "istart-story-views" });
    this.dialogueButton = this.button(views, "对话现场", () => { this.mode = "dialogue"; this.patch(this.currentMessage); });
    this.proseButton = this.button(views, "小说正文", () => { this.mode = "prose"; this.patch(this.currentMessage); });
    this.content = root.createDiv({ cls: "istart-story-blocks", attr: { "aria-label": "演绎正文" } });
    this.warning = root.createDiv({ cls: "istart-agent-error", attr: { role: "alert" } });
    this.toolbar = root.createDiv({ cls: "istart-story-controls" });
    this.addAction("auto", "自动接话", () => this.controller.continueStory(this.session.id, this.currentMessage.id));
    this.addAction("step", "推进一步", () => this.controller.continueStory(this.session.id, this.currentMessage.id, true));
    this.addAction("pause", "说完后暂停", () => this.controller.pauseStory(this.session.id, this.currentMessage.id));
    this.addAction("stop", "立即打断", () => this.controller.stop(this.session.id));
    this.target = this.toolbar.createEl("select", { attr: { "aria-label": "指定下一步演绎" } });
    this.target.createEl("option", { value: "", text: "指定下一步…" });
    for (const card of this.scene.cast) this.target.createEl("option", { value: card.path, text: `让${storyName(this.scene, card.path)}接话` });
    this.target.createEl("option", { value: "scene", text: "推进情境" });
    this.target.addEventListener("change", () => this.actions.perform(() => {
      if (this.target.value) this.controller.directStory(this.session.id, this.currentMessage.id, "", this.target.value);
      this.target.value = "";
    }));
    this.addAction("confirm", "确认剧情并推演角色", () => this.actions.confirm());
    const more = this.toolbar.createEl("details", { cls: "istart-story-more" });
    more.createEl("summary", { text: "场景操作" });
    const moreActions = more.createDiv({ cls: "istart-story-controls" });
    this.addAction("end", "结束本场", () => this.controller.endStory(this.session.id, this.currentMessage.id), moreActions);
    this.addAction("dismiss", "保留草稿并另起一场", () => this.controller.dismissStory(this.session.id, this.currentMessage.id), moreActions);
    this.button(moreActions, "复制正文", () => this.actions.copy(serializeStory(this.scene.confirmedAt !== undefined ? this.scene.confirmedBlocks ?? [] : this.scene.blocks)));
    this.evolution = root.createDiv({ cls: "istart-story-evolution" });
    this.evolutionText = this.evolution.createDiv({ cls: "istart-story-evolution-text" });
    this.button(this.evolution, "重试角色推演", () => this.controller.confirmStory(this.session.id, this.currentMessage.id));
    this.button(this.evolution, "保留剧情，暂不更新角色", () => this.controller.skipStoryEvolution(this.session.id, this.currentMessage.id));
    this.details = root.createEl("details", { cls: "istart-agent-details" });
    this.details.createEl("summary", { text: "执行与资料记录" });
    this.diagnostics = this.details.createDiv();
    this.details.addEventListener("toggle", () => { if (this.details.open) this.patchDiagnostics(); });
    this.patch(message);
  }
  private button(parent: HTMLElement, label: string, action: () => unknown): HTMLButtonElement {
    const button = parent.createEl("button", { text: label, cls: "istart-agent-text-button", attr: { type: "button", "aria-label": label } });
    button.addEventListener("click", () => this.actions.perform(action)); return button;
  }
  private addAction(key: string, label: string, action: () => unknown, parent = this.toolbar): void { this.buttons.set(key, this.button(parent, label, action)); }
  patch(message: AgentMessage): void {
    this.currentMessage = message; this.scene = message.story as LiveStoryScene;
    const scene = this.scene, busy = this.controller.isRunning(this.session.id), locked = this.session.archived || this.session.mode !== "story";
    const published = scene.confirmedAt !== undefined ? scene.confirmedBlocks ?? [] : scene.blocks;
    this.content.dataset.presentation = this.mode;
    this.dialogueButton.setAttribute("aria-pressed", String(this.mode === "dialogue"));
    this.proseButton.setAttribute("aria-pressed", String(this.mode === "prose"));
    const ids = new Set(published.map(b => b.id));
    for (const [id, node] of this.blocks) if (!ids.has(id)) { node.root.remove(); this.blocks.delete(id); }
    for (const block of published) this.patchBlock(block, busy || locked || scene.confirmedAt !== undefined);
    const pending = scene.runtime.pendingTurn;
    const label = scene.dismissed ? "本场已保留为草稿" : scene.confirmedAt !== undefined ? "已确认剧情" : busy && scene.state === "running" ? pending ? `${pending.target === "scene" ? "场景正在展开" : `${storyName(scene, pending.target)}正在回应`}${scene.runtime.transport === "buffered" ? " · 等待完整回应" : "…"}${scene.runtime.pauseRequested ? " · 本次回应结束后暂停" : ""}` : "正在选择下一步…" : scene.state === "review" ? "本场已结束 · 等待确认" : scene.state === "interrupted" ? "演绎已中断 · 原稿保留" : "演绎已暂停 · 可继续或确认";
    if (this.status.textContent !== label) this.status.setText(label);
    const warning = message.error ?? ""; if (this.warning.textContent !== warning) this.warning.setText(warning); this.warning.toggle(!!warning);
    const unresolved = scene.blocks.some(b => b.status !== "completed" && !b.omitted);
    const open = !scene.dismissed && scene.confirmedAt === undefined;
    for (const [key, button] of this.buttons) {
      button.toggle(open && (["pause", "stop"].includes(key) ? busy : ["auto", "step", "confirm"].includes(key) ? !busy : true));
      button.disabled = locked || this.controller.isApplying || (["pause", "stop"].includes(key) ? !busy : ["end"].includes(key) ? false : busy || unresolved);
    }
    this.buttons.get("dismiss")!.disabled = busy || locked;
    this.buttons.get("confirm")!.disabled = busy || locked || unresolved || !serializeStory(scene.blocks, false).trim();
    this.buttons.get("pause")!.disabled = !busy || locked || scene.runtime.pauseRequested === true;
    this.target.toggle(open); this.target.disabled = locked;
    this.evolution.toggle(scene.confirmedAt !== undefined && !!scene.evolution);
    const evolutionText = [scene.evolution?.status === "running" ? "正在推演角色变化…" : "", scene.evolution?.content, scene.evolution?.error].filter(Boolean).join("\n\n");
    if (this.evolutionText.textContent !== evolutionText) this.evolutionText.setText(evolutionText);
    for (const button of Array.from(this.evolution.querySelectorAll("button"))) { button.toggle(scene.evolution?.status === "error"); button.disabled = busy || locked; }
    if (this.details.open) this.patchDiagnostics();
  }
  private patchBlock(block: StoryBlock, locked: boolean): void {
    let node = this.blocks.get(block.id);
    if (!node) {
      const root = this.content.createDiv({ cls: `istart-story-block is-${block.kind}${block.visibility === "private" ? " is-private" : ""}` });
      if (block.kind === "dialogue") root.createDiv({ cls: "istart-story-speaker", text: storyName(this.scene, block.characterPath!) });
      root.setAttribute("aria-label", block.kind === "dialogue" ? `${storyName(this.scene, block.characterPath!)}的对白` : block.visibility === "private" ? `${storyName(this.scene, block.ownerPath!)}的心理描写` : "场景叙述");
      const textEl = root.createDiv({ cls: "istart-story-text" }), text = root.ownerDocument.createTextNode(""); textEl.appendChild(text);
      const notice = root.createDiv({ cls: "istart-agent-muted" }), controls = root.createDiv({ cls: "istart-story-fragment-controls" });
      this.button(controls, "保留此片段", () => this.controller.resolveStoryBlock(this.session.id, this.currentMessage.id, block.id, true));
      this.button(controls, "跳过此片段", () => this.controller.resolveStoryBlock(this.session.id, this.currentMessage.id, block.id, false));
      node = { root, text, notice, controls }; this.blocks.set(block.id, node);
    }
    if (node.text.data !== block.text) {
      if (block.text.startsWith(node.text.data)) node.text.appendData(block.text.slice(node.text.length)); else node.text.data = block.text;
    }
    node.root.toggleClass("is-omitted", !!block.omitted);
    node.root.toggleClass("is-streaming", block.status === "streaming");
    const notice = block.omitted ? "此片段已跳过，原稿保留" : block.status === "interrupted" ? "未完成片段 · 请保留或跳过" : "";
    if (node.notice.textContent !== notice) node.notice.setText(notice); node.notice.toggle(!!notice);
    node.controls.toggle(block.status === "interrupted" && !block.omitted);
    for (const button of Array.from(node.controls.querySelectorAll("button"))) button.disabled = locked;
  }
  private patchDiagnostics(): void {
    const key = JSON.stringify([this.currentMessage.steps, this.scene.runtime.directives, this.scene.runtime.failures, this.currentMessage.sources]);
    if (key === this.diagnosticsKey) return; this.diagnosticsKey = key; this.diagnostics.empty();
    for (const step of this.currentMessage.steps ?? []) this.diagnostics.createEl("p", { text: `${step.label} · ${step.status}${step.detail ? `\n${step.detail}` : ""}` });
    for (const directive of this.scene.runtime.directives) this.diagnostics.createEl("p", { text: `作者调度：${directive.text || directive.target || "自然推进"}` });
    for (const failure of this.scene.runtime.failures ?? []) {
      this.diagnostics.createEl("p", { text: `中断记录：${failure.error}` });
      this.diagnostics.createEl("pre", { text: failure.raw });
    }
    for (const source of this.currentMessage.sources ?? []) this.diagnostics.createEl("p", { text: source });
  }
}
