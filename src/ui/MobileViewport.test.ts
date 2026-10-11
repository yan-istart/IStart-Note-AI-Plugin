import { describe, expect, it } from "vitest";
import { getMobileViewport } from "./MobileViewport";

describe("mobile viewport above the keyboard", () => {
  it("uses Obsidian's native keyboard height when the WebView viewport does not resize", () => {
    const visible = getMobileViewport(844, 390, 340, { height: 844, width: 390, offsetTop: 0, offsetLeft: 0 });
    expect(visible.height).toBe(504);
    expect(visible.keyboardVisible).toBe(true);
  });

  it("does not subtract the keyboard twice when both native and browser signals are present", () => {
    expect(getMobileViewport(844, 390, 340, { height: 504, width: 390, offsetTop: 0, offsetLeft: 0 }).height).toBe(504);
  });

  it("keeps a panned viewport within both visible bounds", () => {
    const visible = getMobileViewport(844, 390, 340, { height: 504, width: 380, offsetTop: 20, offsetLeft: 10 });
    expect(visible.top + visible.height).toBe(504);
    expect(visible).toMatchObject({ top: 20, left: 10, width: 380 });
  });

  it("supports browser-only keyboard resizing and devices without VisualViewport", () => {
    expect(getMobileViewport(844, 390, 0, { height: 360, width: 390, offsetTop: 0, offsetLeft: 0 }).height).toBe(360);
    expect(getMobileViewport(844, 390, 340).height).toBe(504);
  });

  it("restores the available height after the keyboard closes", () => {
    expect(getMobileViewport(844, 390, 0, { height: 844, width: 390, offsetTop: 0, offsetLeft: 0 }))
      .toMatchObject({ height: 844, keyboardVisible: false });
  });
});
