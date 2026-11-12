import { App, Modal } from "obsidian";
import { textOf } from "../../core/sync/GitSyncEngine";
import { lineDiff } from "../../core/sync/LineDiff";
import { BaiduGitSyncService } from "./BaiduGitSyncService";

export class GitDiffModal extends Modal {
  private generation = 0;
  constructor(app: App, private service: BaiduGitSyncService, private path: string) { super(app); }
  onOpen() {
    const generation = ++this.generation;
    this.modalEl.addClass("istart-git-diff-modal");
    this.titleEl.setText(`文件差异 · ${this.path}`);
    this.contentEl.createEl("p", { text: "最近本地 Git 版本 → 当前文件。此比较不代表云端同步状态。", cls: "istart-sync-hint" });
    const body = this.contentEl.createDiv({ text: "读取差异…" });
    void this.service.localDiff(this.path).then(({ before, after }) => {
      if (generation !== this.generation) return;
      body.empty();
      if ([before, after].some(bytes => bytes && bytes.length > 1_000_000)) {
        body.createEl("p", { text: "文件较大，暂不展开文本差异。" }); return;
      }
      const oldText = before ? textOf(before) : "", newText = after ? textOf(after) : "";
      if (oldText === undefined || newText === undefined) {
        body.createEl("p", { text: `二进制附件不展示逐行差异。原版本：${before?.length ?? 0} 字节；当前：${after?.length ?? 0} 字节。` }); return;
      }
      if (!before) body.createEl("p", { text: "新增文件（原版本中不存在）" });
      if (!after) body.createEl("p", { text: "文件已删除（显示原版本内容）" });
      if (oldText === newText) { body.createEl("p", { text: before && after ? "内容无变化" : "空文件" }); return; }
      const lines = lineDiff(oldText, newText);
      if (!lines) {
        body.createEl("p", { text: "行数较多，使用双栏原文比较。" });
        const columns = body.createDiv({ cls: "istart-git-comparison" });
        for (const [title, text] of [["原版本", oldText], ["当前文件", newText]]) {
          const col = columns.createDiv(); col.createEl("h4", { text: title }); col.createEl("pre", { text, cls: "istart-git-preview" });
        }
        return;
      }
      body.createEl("p", { text: `新增 ${lines.filter(l => l.kind === "added").length} 行 · 删除 ${lines.filter(l => l.kind === "deleted").length} 行` });
      const diff = body.createDiv({ cls: "istart-git-diff", attr: { "aria-label": "逐行差异" } });
      for (const line of lines) {
        const row = diff.createDiv({ cls: `istart-git-diff-line is-${line.kind}` });
        row.createSpan({ cls: "istart-git-diff-number", text: String(line.oldLine ?? "") });
        row.createSpan({ cls: "istart-git-diff-number", text: String(line.newLine ?? "") });
        row.createSpan({ cls: "istart-git-diff-sign", text: line.kind === "added" ? "+" : line.kind === "deleted" ? "−" : " " });
        row.createSpan({ cls: "istart-git-diff-text", text: line.text.replace(/\n$/, "") || " " });
        if (!line.text.endsWith("\n")) row.createSpan({ cls: "istart-sync-hint", text: " ↵ 无末尾换行" });
      }
    }).catch((error: Error) => { if (generation === this.generation) body.setText(error.message); });
  }
  onClose() { this.generation++; this.contentEl.empty(); }
}
