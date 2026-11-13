import type { App } from "obsidian";

const active = new WeakSet<App>();

/** Serialize legacy backup, restore, sync and conflict application in this vault. */
export async function withFileSyncLock<T>(app: App, operation: () => Promise<T>): Promise<T> {
  if (active.has(app)) throw new Error("此笔记库正在进行文件同步，请等待完成");
  active.add(app);
  try { return await operation(); }
  finally { active.delete(app); }
}
