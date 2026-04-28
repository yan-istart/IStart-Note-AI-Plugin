/**
 * 同步元数据管理
 *
 * 在百度云远端存储一个 sync-meta.json，记录上次同步时每个文件的状态。
 * 用于判断文件是本地新增/修改、远端新增/修改，还是冲突。
 *
 * 结构：
 * {
 *   "Knowledge/Q&A/2026-04-25-xxx.md": {
 *     "localMtime": 1714000000000,   // 上次同步时本地 mtime（ms）
 *     "remoteMtime": 1714000000,     // 上次同步时远端 mtime（s）
 *     "size": 1234,
 *     "syncedAt": "2026-04-25T10:00:00.000Z"
 *   }
 * }
 */

export interface FileSyncRecord {
  localMtime: number;   // ms
  remoteMtime: number;  // s（百度 API 返回秒）
  size: number;
  syncedAt: string;     // ISO
}

export type SyncMeta = Record<string, FileSyncRecord>;

export enum SyncAction {
  Upload = "upload",       // 本地新增或修改 → 上传
  Download = "download",   // 远端新增或修改 → 下载
  Conflict = "conflict",   // 两边都改了 → 冲突
  Unchanged = "unchanged", // 无变化
  LocalOnly = "local-only",   // 本地有、远端没有、meta 也没有 → 新文件，上传
  RemoteOnly = "remote-only", // 远端有、本地没有、meta 也没有 → 新文件，下载
  LocalDeleted = "local-deleted",   // meta 有记录但本地没了 → 远端也删
  RemoteDeleted = "remote-deleted", // meta 有记录但远端没了 → 本地也删（谨慎）
}

export interface SyncPlan {
  path: string;
  action: SyncAction;
  localMtime?: number;
  remoteMtime?: number;
}

export class BaiduSyncMeta {
  private data: SyncMeta = {};

  constructor(raw?: string) {
    if (raw) {
      try {
        this.data = JSON.parse(raw);
      } catch {
        this.data = {};
      }
    }
  }

  get(path: string): FileSyncRecord | undefined {
    return this.data[path];
  }

  set(path: string, record: FileSyncRecord) {
    this.data[path] = record;
  }

  delete(path: string) {
    delete this.data[path];
  }

  has(path: string): boolean {
    return path in this.data;
  }

  keys(): string[] {
    return Object.keys(this.data);
  }

  toJSON(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * 计算同步计划
   *
   * @param localFiles  本地文件 map：path → mtime(ms)
   * @param remoteFiles 远端文件 map：path → mtime(s)
   */
  buildSyncPlan(
    localFiles: Map<string, number>,
    remoteFiles: Map<string, number>
  ): SyncPlan[] {
    const plans: SyncPlan[] = [];
    const visited = new Set<string>();

    // 遍历本地文件
    for (const [path, localMtime] of localFiles) {
      visited.add(path);
      const remoteMtime = remoteFiles.get(path);
      const record = this.data[path];

      if (!record) {
        // meta 无记录
        if (remoteMtime === undefined) {
          // 本地新文件
          plans.push({ path, action: SyncAction.LocalOnly, localMtime });
        } else {
          // 两边都有但没有 meta，保守处理：以本地为准上传
          plans.push({ path, action: SyncAction.Upload, localMtime, remoteMtime });
        }
        continue;
      }

      const localChanged = localMtime > record.localMtime + 1000; // 1s 容差
      const remoteChanged = remoteMtime !== undefined && remoteMtime > record.remoteMtime;

      if (!localChanged && !remoteChanged) {
        plans.push({ path, action: SyncAction.Unchanged });
      } else if (localChanged && !remoteChanged) {
        plans.push({ path, action: SyncAction.Upload, localMtime, remoteMtime });
      } else if (!localChanged && remoteChanged) {
        plans.push({ path, action: SyncAction.Download, localMtime, remoteMtime });
      } else {
        // 两边都改了 → 冲突
        plans.push({ path, action: SyncAction.Conflict, localMtime, remoteMtime });
      }
    }

    // 遍历远端文件（找出本地没有的）
    for (const [path, remoteMtime] of remoteFiles) {
      if (visited.has(path)) continue;
      const record = this.data[path];

      if (!record) {
        // 远端新文件，本地没有
        plans.push({ path, action: SyncAction.RemoteOnly, remoteMtime });
      } else {
        // meta 有记录但本地没了 → 本地删除了
        plans.push({ path, action: SyncAction.LocalDeleted, remoteMtime });
      }
    }

    // 找出 meta 有记录但两边都没有的（已被双方删除，清理 meta）
    for (const path of this.keys()) {
      if (!localFiles.has(path) && !remoteFiles.has(path)) {
        plans.push({ path, action: SyncAction.Unchanged }); // 双方都删了，meta 清理即可
      }
    }

    return plans;
  }

  /** 同步完成后更新 meta 记录 */
  recordSync(path: string, localMtime: number, remoteMtime: number, size: number) {
    this.data[path] = {
      localMtime,
      remoteMtime,
      size,
      syncedAt: new Date().toISOString(),
    };
  }
}
