import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Platform, editorInfoField, setIcon } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { ALL_ACTIONS } from "../../actions/definitions";
import { buildContext, evaluateWhen, openPanel } from "../../actions/registry";
import type { ActionDef, ActionContext } from "../../actions/types";
import { panelIcon } from "../../ui/icons";

const MAX_ACTIONS = 5;
const SELECTION_DELAY = 100;
const CURSOR_DELAY = 650;

/** Curated toolbar order; actions still go through their normal `when` rules. */
const SELECTION_ACTION_IDS = [
  "add-annotation",
  "ai-annotation",
  "polish-writing",
  "expand-selection",
  "explain-selection",
  "ai-assistant",
];

const CURSOR_ACTION_IDS = [
  "continue-writing",
  "insert-writing",
  "generate-next-chapter",
  "summarize-note",
  "ai-assistant",
  "extract-characters",
];

/**
 * Render a floating action bar for the current editor selection.
 * Cursor mode is opt-in and shows a small trigger after the cursor has been idle.
 */
class FloatingToolbarView {
  private toolbar: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private timer: number | undefined;
  private frame: number | undefined;
  private win: Window;
  private doc: Document;

  constructor(private view: EditorView, private plugin: DeepSeekPlugin) {
    this.win = view.dom.ownerDocument.defaultView ?? window;
    this.doc = view.dom.ownerDocument;
    view.scrollDOM.addEventListener("scroll", this.onScroll, true);
    view.dom.addEventListener("keydown", this.onKeyDown);
    view.dom.addEventListener("compositionstart", this.onComposition);
    view.dom.addEventListener("contextmenu", this.onContextMenu);
    this.doc.addEventListener("mousedown", this.onDocumentMouseDown, true);
    this.win.addEventListener("resize", this.onResize);
    this.scheduleForCurrentState();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.reset();
      this.scheduleForCurrentState();
      return;
    }
    if (update.viewportChanged || update.geometryChanged) this.schedulePosition();
  }

  destroy(): void {
    this.clearTimers();
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll, true);
    this.view.dom.removeEventListener("keydown", this.onKeyDown);
    this.view.dom.removeEventListener("compositionstart", this.onComposition);
    this.view.dom.removeEventListener("contextmenu", this.onContextMenu);
    this.doc.removeEventListener("mousedown", this.onDocumentMouseDown, true);
    this.win.removeEventListener("resize", this.onResize);
    this.hideAll();
  }

  private scheduleForCurrentState(): void {
    if (!this.canShow()) return;
    const selection = this.view.state.selection.main;
    if (selection.from !== selection.to) {
      if (!this.plugin.settings.floatingToolbar.showOnSelection) return;
      this.timer = this.win.setTimeout(() => this.showSelectionToolbar(), SELECTION_DELAY);
      return;
    }
    if (this.plugin.settings.floatingToolbar.showAtCursor) {
      this.timer = this.win.setTimeout(() => this.showCursorHandle(), CURSOR_DELAY);
    }
  }

  private canShow(): boolean {
    const settings = this.plugin.settings.floatingToolbar;
    if (!settings.enabled) return false;
    if (Platform.isMobile && !settings.mobile) return false;
    if (!this.view.hasFocus || this.view.composing) return false;
    if (this.view.state.selection.ranges.length > 1) return false;
    const info = this.view.state.field(editorInfoField, false);
    return !!info?.editor;
  }

  private showSelectionToolbar(): void {
    this.timer = undefined;
    const selection = this.view.state.selection.main;
    if (!this.canShow() || selection.from === selection.to) return;
    this.renderToolbar(true, selection.head);
  }

  private showCursorHandle(): void {
    this.timer = undefined;
    if (!this.canShow()) return;
    const selection = this.view.state.selection.main;
    if (selection.from !== selection.to) return;
    this.hideHandle();
    const handle = this.doc.createElement("button");
    handle.className = "istart-floating-toolbar-handle";
    handle.type = "button";
    handle.title = "IStart 操作";
    handle.setAttribute("aria-label", "打开 IStart 操作");
    handle.style.visibility = "hidden";
    setIcon(handle.createSpan({ cls: "istart-floating-toolbar-handle-icon" }), "istart-assistant");
    handle.addEventListener("pointerdown", (event) => event.preventDefault());
    handle.addEventListener("mousedown", (event) => event.preventDefault());
    handle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hideHandle();
      this.renderToolbar(false, this.view.state.selection.main.head);
    });
    this.handle = handle;
    this.doc.body.appendChild(handle);
    this.positionHandle(handle, selection.head);
  }

  private renderToolbar(hasSelection: boolean, anchorPos: number): void {
    this.hideToolbar();
    const ctx = buildContext(this.plugin, null);
    if (!ctx.editor) return;
    const actions = this.toolbarActions(ctx, hasSelection);
    if (actions.length === 0) return;

    const toolbar = this.doc.createElement("div");
    toolbar.className = "istart-floating-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "IStart 快捷操作");
    toolbar.style.visibility = "hidden";

    for (const action of actions) this.addActionButton(toolbar, action, ctx);
    const more = toolbar.createEl("button", {
      cls: "istart-floating-toolbar-item is-more",
      attr: { type: "button", title: "更多功能", "aria-label": "更多功能" },
    });
    setIcon(more.createSpan({ cls: "istart-floating-toolbar-icon" }), "more-horizontal");
    more.createSpan({ text: "更多", cls: "istart-floating-toolbar-label" });
    this.bindButton(more, () => {
      this.hideAll();
      openPanel(this.plugin, ALL_ACTIONS);
    });

    this.toolbar = toolbar;
    this.doc.body.appendChild(toolbar);
    this.positionToolbar(toolbar, anchorPos);
  }

  private addActionButton(container: HTMLElement, action: ActionDef, ctx: ActionContext): void {
    const button = container.createEl("button", {
      cls: "istart-floating-toolbar-item",
      attr: {
        type: "button",
        title: action.description ? `${action.label} — ${action.description}` : action.label,
        "aria-label": action.label,
      },
    });
    setIcon(button.createSpan({ cls: "istart-floating-toolbar-icon" }), panelIcon(action.icon));
    button.createSpan({ text: action.label, cls: "istart-floating-toolbar-label" });
    this.bindButton(button, () => {
      const current = buildContext(this.plugin, null);
      this.hideAll();
      action.run(current ?? ctx);
    });
  }

  private bindButton(button: HTMLElement, callback: () => void): void {
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      callback();
    });
  }

  private toolbarActions(ctx: ActionContext, hasSelection: boolean): ActionDef[] {
    const ids = hasSelection ? SELECTION_ACTION_IDS : CURSOR_ACTION_IDS;
    return ALL_ACTIONS
      .filter((action) => ids.includes(action.id) && evaluateWhen(action.when, ctx))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
      .slice(0, MAX_ACTIONS);
  }

  private positionToolbar(toolbar: HTMLElement, pos: number): void {
    const coords = this.view.coordsAtPos(pos, 1) ?? this.view.coordsAtPos(pos);
    if (!coords) {
      this.hideToolbar();
      return;
    }
    const rect = toolbar.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = this.win.innerWidth;
    const preferredTop = coords.top - rect.height - margin;
    const fallbackTop = coords.bottom + margin;
    const top = clamp(
      preferredTop >= margin ? preferredTop : fallbackTop,
      margin,
      Math.max(margin, this.win.innerHeight - rect.height - margin)
    );
    const anchorX = (coords.left + coords.right) / 2;
    const left = clamp(anchorX - rect.width / 2, margin, Math.max(margin, viewportWidth - rect.width - margin));
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    toolbar.style.visibility = "visible";
  }

  private positionHandle(handle: HTMLElement, pos: number): void {
    const coords = this.view.coordsAtPos(pos, 1) ?? this.view.coordsAtPos(pos);
    if (!coords) {
      this.hideHandle();
      return;
    }
    const rect = handle.getBoundingClientRect();
    const margin = 4;
    const left = clamp(coords.right + margin, margin, Math.max(margin, this.win.innerWidth - rect.width - margin));
    const top = clamp(coords.top - 2, margin, Math.max(margin, this.win.innerHeight - rect.height - margin));
    handle.style.left = `${left}px`;
    handle.style.top = `${top}px`;
    handle.style.visibility = "visible";
  }

  private schedulePosition(): void {
    if (!this.toolbar && !this.handle) return;
    if (this.frame !== undefined) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = undefined;
      const pos = this.view.state.selection.main.head;
      if (this.toolbar) this.positionToolbar(this.toolbar, pos);
      if (this.handle) this.positionHandle(this.handle, pos);
    });
  }

  private reset(): void {
    this.clearTimers();
    this.hideAll();
  }

  private clearTimers(): void {
    if (this.timer !== undefined) {
      this.win.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.frame !== undefined) {
      this.win.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
  }

  private hideAll(): void {
    this.hideToolbar();
    this.hideHandle();
  }

  private hideToolbar(): void {
    this.toolbar?.remove();
    this.toolbar = null;
  }

  private hideHandle(): void {
    this.handle?.remove();
    this.handle = null;
  }

  private onScroll = (): void => {
    if (this.toolbar || this.handle) this.schedulePosition();
  };

  private onResize = (): void => {
    if (this.toolbar || this.handle) this.schedulePosition();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.hideAll();
      return;
    }
    if (this.handle) this.hideHandle();
  };

  private onComposition = (): void => {
    this.clearTimers();
    this.hideAll();
  };

  private onContextMenu = (): void => {
    this.hideAll();
  };

  private onDocumentMouseDown = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (this.toolbar?.contains(target) || this.handle?.contains(target))) return;
    this.hideAll();
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Register the floating action bar for all Markdown editors. */
export function createFloatingToolbarExtension(plugin: DeepSeekPlugin): Extension {
  return ViewPlugin.fromClass(class {
    private toolbar: FloatingToolbarView;
    constructor(view: EditorView) {
      this.toolbar = new FloatingToolbarView(view, plugin);
    }
    update(update: ViewUpdate) { this.toolbar.update(update); }
    destroy() { this.toolbar.destroy(); }
  });
}
