import { describe, expect, it } from "vitest";
import { sidebarHeight, fieldScrollDelta } from "./SidebarViewport";
import { getMobileViewport } from "./MobileViewport";

describe("sidebar space above the mobile keyboard", () => {
  it("respects the pane bottom as well as the native keyboard", () => {
    const viewport = getMobileViewport(844, 390, 340, { height: 504, width: 390, offsetTop: 0, offsetLeft: 0 });
    expect(sidebarHeight(80, 800, viewport.top + viewport.height)).toBe(424);
    expect(sidebarHeight(80, 460, viewport.top + viewport.height)).toBe(380);
  });

  it("does not invent a minimum height that places controls behind the keyboard", () => {
    expect(sidebarHeight(480, 844, 504)).toBe(24);
    expect(sidebarHeight(520, 844, 504)).toBe(0);
    expect(sidebarHeight(80, 760, 844)).toBe(680);
  });

  it("reveals a focused field by moving only its scrolling panel", () => {
    expect(fieldScrollDelta(280, 324, 100, 300)).toBe(32);
    expect(fieldScrollDelta(80, 124, 100, 300)).toBe(-28);
    expect(fieldScrollDelta(140, 184, 100, 300)).toBe(0);
    expect(fieldScrollDelta(150, 450, 100, 300)).toBe(42);
  });
});
