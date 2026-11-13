import { App, TFile, normalizePath } from "obsidian";
import { ensureNoteFolder, readNote } from "../../core/agent/Context";
import { parseJob, serviceUrl } from "../../core/publishing/PublishingClient";
import { binaryFingerprint, contentFingerprint, publishingFolder, sanitizeRemoteUrl } from "../../core/publishing/types";
import type { CompiledArticle, PublishingRecord, PublishingSnapshot } from "../../core/publishing/types";

export class PublishingStore {
  constructor(private app: App, private root: () => string) {}
  async snapshot(article: CompiledArticle, sourcePath: string): Promise<PublishingSnapshot> {
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const folder = `${publishingFolder(this.root())}/${day}-${crypto.randomUUID().slice(0, 12)}`;
    await ensureNoteFolder(this.app, `${folder}/稿件.md`);
    const assetHashes = await Promise.all(article.assets.map(async a => {
      await ensureNoteFolder(this.app, `${folder}/assets/${a.name}`);
      await this.app.vault.createBinary(`${folder}/assets/${a.name}`, a.data);
      return binaryFingerprint(a.data);
    }));
    const fingerprint = await contentFingerprint(JSON.stringify({ title: article.title, markdown: article.markdown, assetHashes }));
    const noteContent = `---\ntype: publishing-draft\nsource: ${JSON.stringify(sourcePath)}\ncreated_at: ${date.toISOString()}\nfingerprint: ${fingerprint}\n---\n\n# ${article.title}\n\n${article.markdown}\n`;
    await this.app.vault.create(`${folder}/稿件.md`, noteContent);
    return { folder, sourcePath, title: article.title, markdown: article.markdown, assets: article.assets, fingerprint, noteContent };
  }
  async assertSnapshot(snapshot: PublishingSnapshot): Promise<void> {
    if (await readNote(this.app, `${snapshot.folder}/稿件.md`) !== snapshot.noteContent) throw new Error("已保存的稿件已变化，请打开该稿件重新预览后发送");
    for (const asset of snapshot.assets) {
      const file = this.app.vault.getAbstractFileByPath(`${snapshot.folder}/assets/${asset.name}`);
      if (!(file instanceof TFile)) throw new Error("快照图片已移动或删除，请重新预览");
      const actual = new Uint8Array(await this.app.vault.readBinary(file)), expected = new Uint8Array(asset.data);
      if (actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) throw new Error("快照图片已变化，请重新预览");
    }
  }
  async saveRecord(record: PublishingRecord): Promise<void> {
    if (!this.inside(record.snapshotFolder)) throw new Error("分发记录不在当前分发目录内");
    parseJob(record.job);
    const clean: PublishingRecord = { ...record, job: { ...record.job, results: record.job.results.map(result => ({
      ...result, postUrl: result.postUrl ? sanitizeRemoteUrl(result.postUrl) : undefined,
      // Server errors are deliberately generic; do not retain arbitrary external diagnostics.
      error: result.error ? result.state === "failed" ? "保存失败，请检查连接、账号及内容" : "结果未知，请在平台核对草稿" : undefined,
    })) } };
    const path = normalizePath(`${record.snapshotFolder}/records/${record.job.id}.json`);
    await ensureNoteFolder(this.app, path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.vault.modify(file, JSON.stringify(clean, null, 2));
    else await this.app.vault.create(path, JSON.stringify(clean, null, 2));
  }
  inside(path: string): boolean { const root = publishingFolder(this.root()); return path.startsWith(root + "/"); }
  async records(): Promise<PublishingRecord[]> {
    const files = this.app.vault.getFiles().filter(f => this.inside(f.path) && /\/records\/[a-zA-Z0-9-]{8,80}\.json$/.test(f.path));
    const result: PublishingRecord[] = [];
    for (const file of files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 50)) {
      try {
        const raw: unknown = JSON.parse(await this.app.vault.read(file));
        if (!raw || typeof raw !== "object") continue;
        const record = raw as PublishingRecord;
        if (record.version !== 1 || typeof record.snapshotFolder !== "string" || !this.inside(record.snapshotFolder) || file.path !== `${record.snapshotFolder}/records/${record.job.id}.json`) continue;
        serviceUrl(record.serviceUrl); parseJob(record.job);
        result.push(record);
      } catch { /* A conflicted or unrelated JSON file is never executable state. */ }
    }
    return result;
  }
}
