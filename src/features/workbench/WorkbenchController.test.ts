import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { WorkbenchController, WORKBENCH_VIEWS } from "./WorkbenchController";

function setup(initial: string[] = []) {
  const leaves: WorkspaceLeaf[] = [];
  const add = (initialType: string) => {
    let type = initialType;
    const leaf = {
      view: { getViewType: () => type },
      setViewState: vi.fn(async (state: { type: string }) => { type = state.type; }),
      detach: vi.fn(() => leaves.splice(leaves.indexOf(leaf as unknown as WorkspaceLeaf), 1)),
    } as unknown as WorkspaceLeaf;
    leaves.push(leaf);
    return leaf;
  };
  initial.forEach(add);
  const workspace = {
    getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.view.getViewType() === type),
    ensureSideLeaf: vi.fn(async (type: string) => add(type)),
    revealLeaf: vi.fn(async () => {}),
  };
  return { controller: new WorkbenchController(workspace), workspace, leaves, add };
}

describe("IStart workbench routing", () => {
  it("switches assistant, annotations, and sync in the same leaf", async () => {
    const { controller, workspace, leaves } = setup();
    const assistant = await controller.activate("assistant");
    expect(await controller.activate("annotations")).toBe(assistant);
    expect(await controller.activate("sync")).toBe(assistant);
    expect(await controller.activate("assistant")).toBe(assistant);
    expect(leaves).toHaveLength(1);
    expect(workspace.ensureSideLeaf).toHaveBeenCalledTimes(1);
    expect(assistant.view.getViewType()).toBe(WORKBENCH_VIEWS.assistant);
  });

  it("preserves the current view instance when opening the same section again", async () => {
    const { controller } = setup([WORKBENCH_VIEWS.assistant]);
    const leaf = await controller.activate("assistant");
    await controller.activate("assistant");
    expect(leaf.setViewState).not.toHaveBeenCalled();
  });

  it("merges legacy IStart sidebars without closing other plugin views or notes", async () => {
    const { controller, leaves, workspace } = setup([
      "markdown", WORKBENCH_VIEWS.sync, "another-plugin", WORKBENCH_VIEWS.annotations, WORKBENCH_VIEWS.assistant,
    ]);
    const assistant = leaves[4];
    await controller.consolidate();
    expect(leaves.map(leaf => leaf.view.getViewType())).toEqual(["markdown", "another-plugin", WORKBENCH_VIEWS.assistant]);
    expect(assistant.detach).not.toHaveBeenCalled();
    expect(workspace.ensureSideLeaf).not.toHaveBeenCalled();
    expect(workspace.revealLeaf).not.toHaveBeenCalled();
  });

  it("does not open a workbench automatically for a layout with no IStart sidebar", async () => {
    const { controller, workspace } = setup(["markdown"]);
    await controller.consolidate();
    expect(workspace.ensureSideLeaf).not.toHaveBeenCalled();
  });

  it("serializes rapid section switches without creating duplicate leaves", async () => {
    const { controller, workspace, leaves } = setup();
    const [assistant, annotations, sync] = await Promise.all([
      controller.activate("assistant"), controller.activate("annotations"), controller.activate("sync"),
    ]);
    expect(annotations).toBe(assistant);
    expect(sync).toBe(assistant);
    expect(workspace.ensureSideLeaf).toHaveBeenCalledTimes(1);
    expect(leaves).toHaveLength(1);
    expect(sync.view.getViewType()).toBe(WORKBENCH_VIEWS.sync);
  });

  it("recovers from a failed switch and keeps restored views until a switch succeeds", async () => {
    const { controller, leaves } = setup([WORKBENCH_VIEWS.assistant, WORKBENCH_VIEWS.sync]);
    vi.mocked(leaves[0].setViewState).mockRejectedValueOnce(new Error("cannot open view"));
    await expect(controller.activate("annotations")).rejects.toThrow("cannot open view");
    expect(leaves).toHaveLength(2);
    await controller.activate("annotations");
    expect(leaves).toHaveLength(1);
    expect(leaves[0].view.getViewType()).toBe(WORKBENCH_VIEWS.annotations);
  });

  it("creates a new workbench after the user closes the previous leaf", async () => {
    const { controller, workspace, leaves } = setup();
    const first = await controller.activate("assistant");
    first.detach();
    const next = await controller.activate("sync");
    expect(next).not.toBe(first);
    expect(leaves).toEqual([next]);
    expect(workspace.ensureSideLeaf).toHaveBeenCalledTimes(2);
  });
});
