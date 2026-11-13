import { describe, expect, it, vi } from "vitest";
import { requireApiVersion } from "obsidian";
import type { ButtonComponent } from "obsidian";
import { destructiveButton } from "./compat";

vi.mock("obsidian", () => ({ requireApiVersion: vi.fn() }));
describe("destructive buttons", () => {
  it("retains legacy destructive styling without calling APIs missing on old apps", () => {
    vi.mocked(requireApiVersion).mockReturnValue(false);
    const button = { setClass: vi.fn().mockReturnThis(), get setDestructive(): never { throw new Error("new API unavailable"); } } as unknown as ButtonComponent;
    expect(destructiveButton(button)).toBe(button); expect(button.setClass).toHaveBeenCalledWith("mod-warning");
  });
  it("uses the current API when the app supports it", () => {
    vi.mocked(requireApiVersion).mockReturnValue(true);
    const button = { setDestructive: vi.fn().mockReturnThis(), setClass: vi.fn() } as unknown as ButtonComponent;
    expect(destructiveButton(button)).toBe(button); expect(button.setDestructive).toHaveBeenCalledOnce(); expect(button.setClass).not.toHaveBeenCalled();
  });
});
