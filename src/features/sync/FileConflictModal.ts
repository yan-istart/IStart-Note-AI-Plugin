import { App, Notice } from "obsidian";
import { BaiduSyncConfig } from "../../types";
import { BaiduSyncService } from "./BaiduSyncService";
import { FileConflictService } from "./FileConflictService";
import { SyncConflictModal } from "./SyncConflictModal";

export async function openFileConflicts(
  app: App, config: BaiduSyncConfig, paths: readonly string[], changed: () => Promise<void> = async () => {}, initialPath?: string,
  saveToken: () => Promise<void> = async () => {}
): Promise<void> {
  const notice = new Notice("正在读取冲突双方内容…", 0);
  try {
    const authenticate = async () => {
      if (!await new BaiduSyncService(app, config).ensureValidToken()) throw new Error("Token 已过期，请重新授权");
      await saveToken();
    };
    await authenticate();
    const service = new FileConflictService(app, config);
    let conflicts = await service.prepare(paths);
    if (!conflicts.length) return;
    new SyncConflictModal(app, {
      mode: "file", conflicts, initialPath,
      reload: async () => { await authenticate(); conflicts = await service.prepare(conflicts.map(conflict => conflict.path)); return conflicts; },
      apply: async choices => {
        await authenticate();
        const current = conflicts.filter(conflict => choices.has(conflict.key));
        const result = await service.apply(current, choices);
        const done = new Set(result.resolvedKeys);
        conflicts = conflicts.filter(conflict => !done.has(conflict.key));
        new Notice(`已处理 ${result.resolvedKeys.length} 项冲突${result.errors.length ? `，失败 ${result.errors.length} 项` : ""}。恢复副本：${result.recoveryPath}`);
        await changed();
        return result;
      },
    }).open();
  } catch (error) { new Notice(`读取冲突失败：${(error as Error).message}`); }
  finally { notice.hide(); }
}
