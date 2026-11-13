import { Platform } from "obsidian";
import { getMobileViewport } from "./MobileViewport";

/** Clip a sidebar to both its workspace pane and the visible area above the keyboard. */
export function sidebarHeight(top: number, paneBottom: number, viewportBottom: number): number {
  return Math.max(0, Math.min(paneBottom, viewportBottom) - top);
}

/** Reveal a field by scrolling its own panel, without panning the iOS WebView. */
export function fieldScrollDelta(top: number, bottom: number, panelTop: number, panelBottom: number): number {
  const start = panelTop + 8, end = panelBottom - 8;
  if (top < start || bottom - top > end - start) return top - start;
  return bottom > end ? bottom - end : 0;
}

export function bindSidebarViewport(root: HTMLElement): () => void {
  if (!Platform.isMobile) return () => {};
  const doc = root.ownerDocument, win = doc.defaultView;
  if (!win) return () => {};
  const listeners: (() => void)[] = [];
  let height = Math.max(win.innerHeight, doc.documentElement.clientHeight), width = win.innerWidth;
  let frame: number | undefined;
  const update = () => {
    const active = doc.activeElement;
    const input = active?.instanceOf(HTMLElement) && root.contains(active) && active.matches("input, textarea, select, [contenteditable='true']") ? active : null;
    const keyboard = parseFloat(win.getComputedStyle(root).getPropertyValue("--keyboard-height")) || 0;
    const currentHeight = Math.max(win.innerHeight, doc.documentElement.clientHeight);
    height = width !== win.innerWidth || (!input && keyboard === 0) ? currentHeight : Math.max(height, currentHeight);
    width = win.innerWidth;
    const viewport = getMobileViewport(height, width, keyboard, win.visualViewport);
    const top = root.getBoundingClientRect().top;
    const paneBottom = root.parentElement?.getBoundingClientRect().bottom ?? currentHeight;
    const available = sidebarHeight(top, paneBottom, viewport.top + viewport.height);
    root.style.setProperty("--istart-sidebar-height", `${available}px`);
    root.classList.toggle("istart-sidebar-keyboard-visible", viewport.keyboardVisible);
    root.classList.toggle("istart-sidebar-compact-keyboard", viewport.keyboardVisible && available < 280);
    if (!input) return;
    // Only the nearest scrolling panel moves. Never scroll the document or workspace.
    for (let panel = input.parentElement; panel; panel = panel.parentElement) {
      if (panel.scrollHeight > panel.clientHeight && /auto|scroll/.test(win.getComputedStyle(panel).overflowY)) {
        const field = input.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
        panel.scrollTop += fieldScrollDelta(field.top, field.bottom, bounds.top, Math.min(bounds.bottom, viewport.top + viewport.height));
        break;
      }
      if (panel === root) break;
    }
  };
  const schedule = () => {
    if (frame !== undefined) return;
    frame = win.requestAnimationFrame(() => { frame = undefined; update(); });
  };
  const listen = (target: EventTarget, event: string) => {
    target.addEventListener(event, schedule);
    listeners.push(() => target.removeEventListener(event, schedule));
  };
  for (const event of ["resize", "orientationchange", "keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"]) listen(win, event);
  if (win.visualViewport) { listen(win.visualViewport, "resize"); listen(win.visualViewport, "scroll"); }
  listen(root, "focusin"); listen(root, "focusout");
  const observer = new win.MutationObserver(schedule);
  for (const node of [doc.documentElement, doc.body]) observer.observe(node, { attributes: true, attributeFilter: ["style", "class"] });
  const resizeObserver = new ResizeObserver(schedule);
  if (root.parentElement) resizeObserver.observe(root.parentElement);
  update();
  return () => {
    listeners.forEach(remove => remove()); observer.disconnect(); resizeObserver.disconnect();
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    root.style.removeProperty("--istart-sidebar-height");
    root.classList.remove("istart-sidebar-keyboard-visible", "istart-sidebar-compact-keyboard");
  };
}
