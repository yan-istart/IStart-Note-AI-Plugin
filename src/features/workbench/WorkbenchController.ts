import type { Workspace, WorkspaceLeaf } from "obsidian";

// Keep the existing view types so saved Obsidian layouts remain readable.
export const WORKBENCH_VIEWS = {
  assistant: "istart-agent-view",
  annotations: "istart-annotations-view",
  sync: "istart-baidu-sync-view",
} as const;

export type WorkbenchSection = keyof typeof WORKBENCH_VIEWS;
type WorkbenchWorkspace = Pick<Workspace, "getLeavesOfType" | "ensureSideLeaf" | "revealLeaf">;

/** Route the workbench sections through one leaf, including restored legacy views. */
export class WorkbenchController {
  private leaf?: WorkspaceLeaf;
  private operations: Promise<unknown> = Promise.resolve();

  constructor(private workspace: WorkbenchWorkspace) {}

  private leaves(): WorkspaceLeaf[] {
    return [...new Set(Object.values(WORKBENCH_VIEWS).flatMap(type => this.workspace.getLeavesOfType(type)))];
  }

  private primary(): WorkspaceLeaf | undefined {
    const leaves = this.leaves();
    return this.leaf && leaves.includes(this.leaf) ? this.leaf : leaves[0];
  }

  private queued<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operations.then(action);
    this.operations = result.catch(() => undefined);
    return result;
  }

  activate(section: WorkbenchSection): Promise<WorkspaceLeaf> {
    return this.queued(async () => {
      const type = WORKBENCH_VIEWS[section];
      const leaf = this.primary() ?? await this.workspace.ensureSideLeaf(type, "right", {
        active: true, reveal: true, split: false,
      });
      if (leaf.view.getViewType() !== type) await leaf.setViewState({ type, active: true });
      this.leaf = leaf;
      await this.workspace.revealLeaf(leaf);
      this.removeDuplicates(leaf);
      return leaf;
    });
  }

  /** Collapse only IStart sections from older layouts, without opening a new sidebar. */
  consolidate(): Promise<void> {
    return this.queued(async () => {
      const leaf = this.primary();
      if (!leaf) return;
      this.leaf = leaf;
      this.removeDuplicates(leaf);
    });
  }

  private removeDuplicates(primary: WorkspaceLeaf): void {
    for (const leaf of this.leaves()) if (leaf !== primary) leaf.detach();
  }
}
