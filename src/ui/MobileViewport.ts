interface Viewport {
  height: number;
  width: number;
  offsetTop: number;
  offsetLeft: number;
}

/** Combine the browser viewport and Obsidian's native keyboard inset without subtracting it twice. */
export function getMobileViewport(layoutHeight: number, layoutWidth: number, keyboardHeight: number, viewport?: Viewport | null) {
  const nativeInset = Number.isFinite(keyboardHeight) ? Math.max(0, keyboardHeight) : 0;
  const top = Math.max(0, viewport?.offsetTop ?? 0);
  const visualBottom = top + (viewport?.height ?? layoutHeight);
  const bottom = Math.min(visualBottom, layoutHeight - nativeInset);
  return {
    top,
    left: Math.max(0, viewport?.offsetLeft ?? 0),
    width: viewport?.width ?? layoutWidth,
    height: Math.max(0, bottom - top),
    keyboardVisible: nativeInset > 0 || layoutHeight - visualBottom > 80,
  };
}
