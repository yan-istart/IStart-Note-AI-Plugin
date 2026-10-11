import { App, Modal, Platform } from "obsidian";
import { getMobileViewport } from "./MobileViewport";

/** A scrolling body and a persistent footer, sized to the visible mobile viewport. */
export class ActionModal extends Modal {
  protected bodyEl!: HTMLElement;
  protected actionsEl!: HTMLElement;
  private cleanups: (() => void)[] = [];
  private focusTimer: number | undefined;
  private mobileHeaderActionsEl: HTMLElement | undefined;
  private keyboardButton: HTMLButtonElement | undefined;

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
    const doc = this.contentEl.ownerDocument;
    const win = doc.defaultView!;
    const viewport = win.visualViewport;
    let layoutHeight = Math.max(win.innerHeight, doc.documentElement.clientHeight);
    let layoutWidth = win.innerWidth;
    let frame: number | undefined;
    const focusedInput = () => {
      const active = doc.activeElement as HTMLElement | null;
      return active && this.contentEl.contains(active) && active.matches("input, textarea, select") ? active : null;
    };
    const revealInput = (input: HTMLElement) => {
      // Scroll the modal body only. scrollIntoView can pan the entire iOS WebView during keyboard animation.
      const field = input.getBoundingClientRect();
      const body = this.bodyEl.getBoundingClientRect();
      if (field.bottom > body.bottom) this.bodyEl.scrollTop += field.bottom - body.bottom;
      if (field.top < body.top) this.bodyEl.scrollTop -= body.top - field.top;
    };
    const update = () => {
      const input = focusedInput();
      const keyboardHeight = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--keyboard-height")) || 0;
      const currentHeight = Math.max(win.innerHeight, doc.documentElement.clientHeight);
      // Preserve the height before keyboard resizing, including WebViews that resize innerHeight as well.
      if (layoutWidth !== win.innerWidth || (!input && keyboardHeight === 0)) layoutHeight = currentHeight;
      else layoutHeight = Math.max(layoutHeight, currentHeight);
      layoutWidth = win.innerWidth;
      const visible = getMobileViewport(layoutHeight, layoutWidth, keyboardHeight, viewport);
      this.containerEl.style.setProperty("--istart-viewport-height", `${visible.height}px`);
      this.containerEl.style.setProperty("--istart-viewport-top", `${visible.top}px`);
      this.containerEl.style.setProperty("--istart-viewport-left", `${visible.left}px`);
      this.containerEl.style.setProperty("--istart-viewport-width", `${visible.width}px`);
      this.modalEl.classList.toggle("istart-keyboard-visible", visible.keyboardVisible);
      this.modalEl.classList.toggle("istart-input-active", !!input);
      if (this.keyboardButton) this.keyboardButton.hidden = !input && !visible.keyboardVisible;
      if (input) revealInput(input);
    };
    const scheduleUpdate = () => {
      if (frame !== undefined) return;
      frame = win.requestAnimationFrame(() => { frame = undefined; update(); });
    };
    let header = this.titleEl.parentElement!;
    if (header === this.modalEl) {
      // Older Obsidian versions put the title directly in the modal.
      header = doc.createElement("div");
      header.addClass("modal-header");
      this.modalEl.insertBefore(header, this.titleEl);
      header.appendChild(this.titleEl);
    }
    this.mobileHeaderActionsEl = header.createDiv({ cls: "istart-modal-header-actions" });
    this.keyboardButton = this.mobileHeaderActionsEl.createEl("button", {
      text: "收起键盘", cls: "istart-dismiss-keyboard", attr: { type: "button" },
    });
    this.listen(this.keyboardButton, "click", () => {
      (doc.activeElement as HTMLElement | null)?.blur();
      win.getSelection()?.removeAllRanges();
      // Keep focus on the dialog even after the keyboard button hides.
      this.modalEl.tabIndex = -1;
      this.modalEl.focus({ preventScroll: true });
      scheduleUpdate();
    });
    const observer = new win.MutationObserver(scheduleUpdate);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    observer.observe(doc.body, { attributes: true, attributeFilter: ["style", "class"] });
    this.cleanups.push(() => { observer.disconnect(); if (frame !== undefined) win.cancelAnimationFrame(frame); });
    update();
    this.listen(win, "resize", scheduleUpdate);
    this.listen(win, "orientationchange", scheduleUpdate);
    for (const event of ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"]) {
      this.listen(win, event, scheduleUpdate);
    }
    if (viewport) {
      this.listen(viewport, "resize", scheduleUpdate);
      this.listen(viewport, "scroll", scheduleUpdate);
    }
    this.listen(this.contentEl, "focusin", scheduleUpdate);
    this.listen(this.contentEl, "focusout", scheduleUpdate);
  }

  /** A second submit entry remains reachable in the title bar if a native keyboard overlaps the footer. */
  protected addMobileHeaderAction(label: string, callback: () => void) {
    if (!this.mobileHeaderActionsEl) return;
    const button = this.mobileHeaderActionsEl.createEl("button", {
      text: label, cls: "istart-header-submit mod-cta", attr: { type: "button" },
    });
    this.mobileHeaderActionsEl.insertBefore(button, this.keyboardButton ?? null);
    this.listen(button, "click", callback);
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
    this.mobileHeaderActionsEl?.remove();
    this.mobileHeaderActionsEl = this.keyboardButton = undefined;
    this.modalEl.removeClass("istart-keyboard-visible", "istart-input-active");
    this.containerEl.removeClass("istart-mobile-modal-container");
    for (const key of ["height", "top", "left", "width"]) this.containerEl.style.removeProperty(`--istart-viewport-${key}`);
    this.contentEl.empty();
  }
}
