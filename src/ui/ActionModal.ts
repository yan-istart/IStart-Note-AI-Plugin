import { App, Modal, Platform } from "obsidian";

/** A scrolling body and a persistent footer, sized to the visible mobile viewport. */
export class ActionModal extends Modal {
  protected bodyEl!: HTMLElement;
  protected actionsEl!: HTMLElement;
  private cleanups: (() => void)[] = [];
  private focusTimer: number | undefined;

  constructor(app: App) {
    super(app);
    this.shouldRestoreSelection = true;
  }

  onOpen() {
    this.modalEl.addClass("istart-action-modal");
    this.contentEl.addClass("istart-action-content");
    this.bodyEl = this.contentEl.createDiv({ cls: "istart-modal-body" });
    this.actionsEl = this.contentEl.createDiv({ cls: "istart-modal-footer" });
    if (!Platform.isMobile) return;

    this.containerEl.addClass("istart-mobile-modal-container");
    const win = this.contentEl.ownerDocument.defaultView!;
    const viewport = win.visualViewport;
    const update = () => {
      // Keyboard resizing and viewport panning both matter on iOS and Android.
      this.containerEl.style.setProperty("--istart-viewport-height", `${viewport?.height ?? win.innerHeight}px`);
      this.containerEl.style.setProperty("--istart-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      this.containerEl.style.setProperty("--istart-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
      this.containerEl.style.setProperty("--istart-viewport-width", `${viewport?.width ?? win.innerWidth}px`);
    };
    update();
    this.listen(win, "resize", update);
    if (viewport) {
      this.listen(viewport, "resize", update);
      this.listen(viewport, "scroll", update);
    }
    this.listen(this.bodyEl, "focusin", (event) => {
      const input = event.target as HTMLElement | null;
      if (input?.matches("input, textarea, select")) input.scrollIntoView({ block: "nearest" });
    });
  }

  protected listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  protected focusOnDesktop(input: HTMLElement) {
    if (Platform.isMobile) return;
    const win = input.ownerDocument.defaultView!;
    this.focusTimer = win.setTimeout(() => input.focus(), 50);
  }

  onClose() {
    if (this.focusTimer !== undefined) this.contentEl.ownerDocument.defaultView?.clearTimeout(this.focusTimer);
    this.focusTimer = undefined;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.containerEl.removeClass("istart-mobile-modal-container");
    for (const key of ["height", "top", "left", "width"]) this.containerEl.style.removeProperty(`--istart-viewport-${key}`);
    this.contentEl.empty();
  }
}
