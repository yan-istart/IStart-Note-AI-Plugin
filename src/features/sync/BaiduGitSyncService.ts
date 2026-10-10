import { App, Platform, TFile } from "obsidian";
import { hashBlob } from "isomorphic-git";
import { BaiduSyncConfig } from "../../types";
import { md5 } from "../../util/md5";
import { GitSyncEngine, GitTransport, GitResolution, GitSyncOutcome, GitVersionDetails, assertNotePath } from "../../core/sync/GitSyncEngine";
import { BaiduPanClient } from "./BaiduPanClient";
import { BaiduSyncService } from "./BaiduSyncService";
import { ObsidianGitFs, ensureDirectory } from "./ObsidianGitFs";

interface ApplyJournal { before: string; after: string }
export interface GitVaultResult extends GitSyncOutcome { changed: number; skipped: number; tracked: number }
export interface GitRestorePreview {
  version: string;
  before: string;
  details: GitVersionDetails;
  skipped: number;
}

const vaultOperations = new WeakMap<App, Promise<void>>();

/** All live-vault writes happen here, after the Git layer finishes validating and merging. */
export class BaiduGitSyncService {
  private readonly engine: GitSyncEngine;
  private readonly storage: string;
  private readonly remote: string;
  private readonly client: BaiduPanClient;
  private readonly transport: GitTransport;

  constructor(private readonly app: App, private readonly config: BaiduSyncConfig) {
    const root = config.remotePath.replace(/\/+$/, "");
    this.remote = `${root}/_istart-git/v1`;
    this.storage = `${app.vault.configDir}/plugins/istart-note-ai/git-sync/${md5(new TextEncoder().encode(root))}`;
    this.engine = new GitSyncEngine(new ObsidianGitFs(app.vault.adapter, this.storage), "git");
    this.client = new BaiduPanClient(config);
    this.transport = {
      list: async () => {
        for (const dir of [root, `${root}/_istart-git`, this.remote]) {
          if (!(await this.client.mkdir(dir))) throw new Error(`无法创建云端版本目录：${dir}`);
        }
        const entries = await this.client.listAllFiles(this.remote, true);
        return entries.filter((e) => !e.isdir && /^[0-9a-f]{40}\.bundle$/.test(e.server_filename))
          .map((e) => e.server_filename.slice(0, -7));
      },
      download: async (oid) => {
        const buffer = await this.client.downloadFile(`${this.remote}/${oid}.bundle`);
        if (!buffer) throw new Error(`下载云端版本失败：${oid.slice(0, 8)}`);
        return new Uint8Array(buffer);
      },
      upload: async (oid, bundle) => {
        const ok = await this.client.uploadFile(Uint8Array.from(bundle).buffer as ArrayBuffer, `${this.remote}/${oid}.bundle`);
        if (!ok) throw new Error("上传版本包失败，本地历史已保留，请重试");
      },
    };
  }

  private async exclusive<T>(run: () => Promise<T>, queue = false): Promise<T> {
    const previous = vaultOperations.get(this.app);
    if (previous && !queue) throw new Error("此笔记库正在同步，请等待完成");
    let complete!: () => void;
    const operation = new Promise<void>((resolve) => { complete = resolve; });
    vaultOperations.set(this.app, operation);
    if (previous) await previous;
    try { await this.engine.initialize(); return await run(); }
    finally {
      if (vaultOperations.get(this.app) === operation) vaultOperations.delete(this.app);
      complete();
    }
  }

  private ignored(path: string, size = 0): boolean {
    if (path.split("/").some((part) => part.startsWith("."))) return true;
    const configDir = this.app.vault.configDir;
    if (path === configDir || path.startsWith(configDir + "/")) return true;
    if (size > this.config.fileSizeLimitMB * 1024 * 1024) return true;
    return !!this.config.ignorePattern && new RegExp(this.config.ignorePattern).test(path);
  }

  scope(): { included: number; excluded: number } {
    const files = this.app.vault.getFiles();
    const included = files.filter((file) => !this.ignored(file.path, file.stat.size)).length;
    return { included, excluded: files.length - included };
  }

  private assertWritablePath(path: string): void {
    assertNotePath(path);
    if (Platform.isWin && (/[<>:"|?*]/.test(path) || path.split("/").some(
      (part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    ))) throw new Error(`Windows 不支持此文件名，请在原设备重命名后重新同步：${path}`);
  }

  private async snapshot(): Promise<{ oid: string; skipped: number }> {
    // Compile before writing anything, so invalid rules cannot accidentally delete tracked notes.
    if (this.config.ignorePattern) new RegExp(this.config.ignorePattern);
    const previous = await this.engine.files(await this.engine.head());
    const protectedPaths = new Set([...previous.keys()].filter((path) => this.ignored(path)));
    // A remote file omitted by the size rule must not look like a local deletion
    // on the next sync, even if it has never been materialized on this device.
    for (const [path, oid] of previous) {
      if (!protectedPaths.has(path) && this.ignored(path, (await this.engine.blob(oid)).length)) protectedPaths.add(path);
    }
    const included: TFile[] = [];
    let skipped = 0;
    for (const file of this.app.vault.getFiles()) {
      if (protectedPaths.has(file.path) || this.ignored(file.path, file.stat.size)) {
        if (previous.has(file.path)) protectedPaths.add(file.path);
        skipped++; continue;
      }
      this.assertWritablePath(file.path);
      included.push(file);
    }
    const vault = this.app.vault;
    const files = (async function* () {
      for (const file of included) yield [file.path, new Uint8Array(await vault.readBinary(file))] as const;
    })();
    return { oid: await this.engine.snapshot(files, protectedPaths), skipped };
  }

  async sync(resolutions = new Map<string, GitResolution>(), onProgress?: (message: string) => void): Promise<GitVaultResult> {
    return this.exclusive(async () => {
      if (!this.config.enabled || !await new BaiduSyncService(this.app, this.config).ensureValidToken()) {
        throw new Error("请启用百度网盘同步并完成授权");
      }
      const pending = await this.readJournal();
      // If an application was interrupted, current edits are committed against the original
      // pre-application tree, then merged with the pending target. Partial writes are idempotent.
      if (pending) await this.engine.setHead(pending.before);
      onProgress?.("扫描整个笔记库并保存本地修改...");
      const snapshot = await this.snapshot();
      onProgress?.("下载版本并合并设备修改...");
      const result = await this.engine.synchronize(this.transport, resolutions, pending?.after);
      const tracked = (await this.engine.files(result.after)).size;
      if (result.conflicts.length) return { ...result, changed: 0, skipped: snapshot.skipped, tracked };
      onProgress?.("应用合并结果...");
      await this.writeJournal({ before: result.before, after: result.after });
      const changed = await this.apply(result.before, result.after);
      await this.engine.setHead(result.after);
      await this.app.vault.adapter.remove(this.journalPath());
      return { ...result, changed, skipped: snapshot.skipped, tracked };
    });
  }

  private journalPath(): string { return `${this.storage}/apply.json`; }

  private async readJournal(): Promise<ApplyJournal | undefined> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.journalPath()))) return undefined;
    const raw: unknown = JSON.parse(await adapter.read(this.journalPath()));
    if (!raw || typeof raw !== "object") throw new Error("本地同步恢复记录损坏");
    const record = raw as Record<string, unknown>;
    if (typeof record.before !== "string" || typeof record.after !== "string"
      || !/^[0-9a-f]{40}$/.test(record.before) || !/^[0-9a-f]{40}$/.test(record.after)) {
      throw new Error("本地同步恢复记录损坏，请保留 git-sync 目录以便恢复");
    }
    return { before: record.before, after: record.after };
  }

  private async writeJournal(journal: ApplyJournal): Promise<void> {
    await this.app.vault.adapter.write(this.journalPath(), JSON.stringify(journal));
  }

  private async apply(before: string, after: string): Promise<number> {
    const original = await this.engine.files(before);
    const target = await this.engine.files(after);
    const changes: { path: string; previous?: string; next?: string; bytes?: Uint8Array }[] = [];
    for (const path of new Set([...original.keys(), ...target.keys()])) {
      assertNotePath(path);
      const previous = original.get(path), next = target.get(path);
      if (previous === next || this.ignored(path)) continue;
      const bytes = next ? await this.engine.blob(next) : undefined;
      if (bytes && this.ignored(path, bytes.length)) continue;
      this.assertWritablePath(path);
      changes.push({ path, previous, next, bytes });
    }
    // Check the entire plan before touching the vault, including new path collisions.
    for (const change of changes) await this.assertUnedited(change.path, change.previous, change.next);
    let changed = 0;
    for (const change of changes) {
      if (!(await this.assertUnedited(change.path, change.previous, change.next))) continue;
      const existing = this.app.vault.getAbstractFileByPath(change.path);
      if (!change.bytes) {
        if (existing instanceof TFile) await this.app.fileManager.trashFile(existing);
      } else {
        const dir = change.path.slice(0, change.path.lastIndexOf("/"));
        if (change.path.includes("/")) await ensureDirectory(this.app.vault.adapter, dir);
        const buffer = Uint8Array.from(change.bytes).buffer as ArrayBuffer;
        if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buffer);
        else await this.app.vault.createBinary(change.path, buffer);
      }
      changed++;
    }
    return changed;
  }

  private async assertUnedited(path: string, previous?: string, next?: string): Promise<boolean> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !(existing instanceof TFile)) throw new Error(`文件与目录冲突：${path}`);
    let current: string | undefined;
    if (existing instanceof TFile) {
      if (this.ignored(path, existing.stat.size)) throw new Error(`文件超出同步范围：${path}`);
      current = (await hashBlob({ object: new Uint8Array(await this.app.vault.readBinary(existing)) })).oid;
    }
    if (current === next) return false;
    if (current !== previous) throw new Error(`同步期间文件发生变化，内容已保留，请再次同步：${path}`);
    return true;
  }

  history() { return this.exclusive(() => this.engine.history(), true); }

  versionDetails(oid: string): Promise<GitVersionDetails> {
    return this.exclusive(() => this.engine.versionDetails(oid), true);
  }

  private async planRestore(oid: string, expectedBefore?: string) {
    if (await this.readJournal()) throw new Error("请先完成中断的同步，再恢复历史版本");
    const target = await this.engine.files(oid);
    // Save every current note before any project-level restore, including new files.
    const snapshot = await this.snapshot();
    if (expectedBefore && snapshot.oid !== expectedBefore) throw new Error("预览后笔记库发生变化，请重新预览恢复范围");
    const current = await this.engine.files(snapshot.oid);
    const protectedPaths = new Set<string>();
    const excludedLocal = new Set(this.app.vault.getFiles()
      .filter((file) => this.ignored(file.path, file.stat.size)).map((file) => file.path));
    for (const path of new Set([...current.keys(), ...target.keys()])) {
      if (excludedLocal.has(path) || this.ignored(path)) { protectedPaths.add(path); continue; }
      for (const blob of new Set([current.get(path), target.get(path)])) {
        if (blob && this.ignored(path, (await this.engine.blob(blob)).length)) { protectedPaths.add(path); break; }
      }
      if (!protectedPaths.has(path) && current.get(path) !== target.get(path)) this.assertWritablePath(path);
    }
    const after = await this.engine.prepareRestore(oid, protectedPaths);
    return { before: snapshot.oid, after, skipped: protectedPaths.size };
  }

  previewRestoreVersion(oid: string): Promise<GitRestorePreview> {
    return this.exclusive(async () => {
      const plan = await this.planRestore(oid);
      return { version: oid, before: plan.before, skipped: plan.skipped,
        details: await this.engine.versionDetails(plan.after, plan.before) };
    });
  }

  restoreVersion(oid: string, expectedBefore?: string): Promise<{ changed: number; skipped: number }> {
    return this.exclusive(async () => {
      const plan = await this.planRestore(oid, expectedBefore);
      await this.writeJournal({ before: plan.before, after: plan.after });
      const changed = await this.apply(plan.before, plan.after);
      await this.engine.setHead(plan.after);
      await this.app.vault.adapter.remove(this.journalPath());
      return { changed, skipped: plan.skipped };
    });
  }

  async version(path: string, oid: string): Promise<Uint8Array> {
    return this.exclusive(() => this.engine.restoreFile(path, oid), true);
  }

  async restoreFile(path: string, oid: string): Promise<void> {
    return this.exclusive(async () => {
      this.assertWritablePath(path);
      if (await this.readJournal()) throw new Error("请先完成中断的同步，再恢复历史版本");
      if (this.ignored(path)) throw new Error("此文件不在同步范围内");
      // Capture the current version first so restoring is itself reversible.
      const snapshot = await this.snapshot();
      const bytes = await this.engine.restoreFile(path, oid);
      if (this.ignored(path, bytes.length)) throw new Error("此历史文件超过大小限制");
      const previous = (await this.engine.files(snapshot.oid)).get(path);
      const next = (await hashBlob({ object: bytes })).oid;
      await this.assertUnedited(path, previous, next);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const buffer = Uint8Array.from(bytes).buffer as ArrayBuffer;
      if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, buffer);
      else {
        if (existing) throw new Error("同名路径是目录，无法恢复");
        if (path.includes("/")) await ensureDirectory(this.app.vault.adapter, path.slice(0, path.lastIndexOf("/")));
        await this.app.vault.createBinary(path, buffer);
      }
      await this.snapshot();
    });
  }
}
