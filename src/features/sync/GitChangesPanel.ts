import { Setting } from "obsidian";
import { CHANGE_LABELS, GitChangesController } from "./GitChangesController";

export function mountGitChangesPanel(root: HTMLElement, controller: GitChangesController): () => void {
  root.createEl("h4", { text: "本地文件改动" });
  root.createEl("p", { text: "相对最近本地 Git 版本；不代表云端已同步。重命名显示为删除旧路径、新增新路径。", cls: "istart-sync-hint" });
  const summary = root.createDiv({ attr: { "aria-live": "polite" } });
  let query = "", kind = "all", limit = 100;
  const list = root.createDiv({ cls: "istart-git-file-list" });
  const render = () => {
    summary.empty(); list.empty();
    if (controller.error) { summary.setText(`读取失败：${controller.error}`); return; }
    const status = controller.status;
    if (!status) { summary.setText(controller.scanning ? "正在扫描本地文件…" : "等待扫描"); return; }
    summary.createEl("p", { text: `新增 ${status.changes.filter(c => c.status === "added").length} · 修改 ${status.changes.filter(c => c.status === "modified").length} · 删除 ${status.changes.filter(c => c.status === "deleted").length}${controller.scanning ? " · 刷新中…" : ""}` });
    if (status.recoveryPending) summary.createEl("p", { text: "存在中断的同步，请先执行同步完成恢复。" });
    if (!status.changes.length) { list.setText("相对最近本地版本无改动；云端状态需执行同步确认。"); return; }
    const files = status.changes.filter(c => (kind === "all" || c.status === kind) && c.path.toLowerCase().includes(query));
    if (!files.length) list.setText("没有符合筛选条件的改动");
    for (const file of files.slice(0, limit)) {
      const row = list.createDiv({ cls: "istart-git-file-row" });
      row.createSpan({ text: CHANGE_LABELS[file.status], cls: `istart-git-change-label is-${file.status}` });
      const button = row.createEl("button", { text: file.path, cls: "istart-git-file-path", attr: { title: "查看逐行差异" } });
      button.addEventListener("click", () => controller.openDiff(file.path));
    }
    if (files.length > limit) {
      const more = list.createEl("button", { text: `显示更多（剩余 ${files.length - limit}）` });
      more.addEventListener("click", () => { limit += 100; render(); });
    }
  };
  const filters = root.createDiv({ cls: "istart-git-change-filters" }); root.insertBefore(filters, list);
  new Setting(filters).addText(text => text.setPlaceholder("筛选文件路径").onChange(value => { query = value.toLowerCase(); limit = 100; render(); }))
    .addDropdown(drop => drop.addOptions({ all: "全部改动", added: "新增", modified: "修改", deleted: "删除" }).onChange(value => { kind = value; limit = 100; render(); }))
    .addButton(btn => btn.setButtonText("刷新").onClick(() => { void controller.refresh(); }));
  return controller.subscribe(render);
}
