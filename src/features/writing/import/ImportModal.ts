import {
  App, Modal, Setting, Notice, TFile, TFolder, TAbstractFile,
  AbstractInputSuggest, normalizePath,
} from "obsidian";
import { DeepSeekSettings } from "../../../types";
import { WritingGenre } from "../types";
import { ChapterSplitter, RawChapter, SplitInputFile, MaterialKind } from "./ChapterSplitter";
import { TextCleaner, CleanOptions, DEFAULT_CLEAN_OPTIONS } from "./TextCleaner";
import { ImportAnalyzer, ImportAnalysis, ImportClassifier } from "./ImportAnalyzer";
import { ImportManager } from "./ImportManager";
import {
  isDesktop, readLocalFile, listLocalManuscriptFiles, fileExtensionOf, basenameOf,
} from "./LocalFileReader";

type SourceMode = "paste" | "vault-file" | "vault-folder" | "local-file" | "local-folder" | "current-file";

/** 原稿支持的格式 */
const SUPPORTED_EXTENSIONS = ["md", "txt"];

const EMPTY_ANALYSIS: ImportAnalysis = {
  oneLiner: "",
  styleProfile: "",
  characters: [],
  worldSettings: [],
};

const GENRE_LABEL: Record<WritingGenre, string> = {
  novel: "网文小说",
  paper: "论文",
  article: "通用长文",
};

const KIND_LABEL: Record<MaterialKind, string> = {
  chapter: "正文(章节)",
  outline: "大纲/细纲",
  setting: "设定/世界观",
  reference: "资料",
  skip: "跳过",
};

/** Vault 路径下拉建议:文件(仅 md/txt)或文件夹 */
class VaultSuggest<T extends TAbstractFile> extends AbstractInputSuggest<T> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private filter: (f: TAbstractFile) => f is T,
    private onPick: (value: T) => void
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): T[] {
    const lower = query.toLowerCase();
    return this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is T => this.filter(f) && f.path.toLowerCase().includes(lower))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 50);
  }

  renderSuggestion(value: T, el: HTMLElement): void {
    el.setText(value.path);
  }

  selectSuggestion(value: T): void {
    this.onPick(value);
    this.close();
  }
}

/** 文件建议:仅 .md / .txt */
class FileSuggest extends VaultSuggest<TFile> {
  constructor(app: App, inputEl: HTMLInputElement, onPick: (v: TFile) => void) {
    super(app, inputEl, (f): f is TFile => f instanceof TFile && SUPPORTED_EXTENSIONS.includes(f.extension), onPick);
  }
}

/** 文件夹建议 */
class FolderSuggest extends VaultSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement, onPick: (v: TFolder) => void) {
    super(app, inputEl, (f): f is TFolder => f instanceof TFolder, onPick);
  }
}

/**
 * 原稿导入向导:
 *  1 来源 → 2 作品信息 → 3 切分预览 → 4 清洗选项 → 5 执行
 */
export class ImportModal extends Modal {
  private step = 1;
  private sourceMode: SourceMode = "paste";
  private pastedText = "";
  private filePath = "";
  private folderPath = "";
  private title = "";
  private genre: WritingGenre = "novel";
  private rawChapters: RawChapter[] = [];
  private cleanOptions: CleanOptions = { ...DEFAULT_CLEAN_OPTIONS };
  private running = false;
  private progressText = "";
  private progressEl: HTMLElement | null = null;
  private importManager: ImportManager | null = null;
  private fileSuggest: FileSuggest | null = null;
  private folderSuggest: FolderSuggest | null = null;
  private localFilePath = "";
  private localFolderPath = "";
  private classifying = false;
  private classifiedBy: "rules" | "ai" = "rules";

  constructor(app: App, private settings: DeepSeekSettings) {
    super(app);
    this.titleEl.setText("导入原稿");
  }

  onOpen() {
    this.render();
  }

  onClose() {
    this.fileSuggest?.close();
    this.folderSuggest?.close();
    this.contentEl.empty();
  }

  // ── 渲染 ───────────────────────────────────────────────────

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("istart-import-modal");

    switch (this.step) {
      case 1: this.renderSource(contentEl); break;
      case 2: this.renderInfo(contentEl); break;
      case 3: this.renderSplitPreview(contentEl); break;
      case 4: this.renderCleanOptions(contentEl); break;
      case 5: this.renderExecute(contentEl); break;
    }
  }

  private stepBar(contentEl: HTMLElement) {
    contentEl.createEl("p", {
      text: `第 ${this.step}/5 步`,
      cls: "istart-import-step",
    });
  }

  private nav(contentEl: HTMLElement, nextLabel: string, onNext: () => void) {
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("上一步").onClick(() => {
          if (this.step > 1) { this.step--; this.render(); }
        })
      )
      .addButton((btn) =>
        btn.setButtonText(nextLabel).setCta().onClick(onNext)
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  // ── 1. 来源 ───────────────────────────────────────────────

  private renderSource(el: HTMLElement) {
    this.stepBar(el);

    new Setting(el)
      .setName("原稿来源")
      .addDropdown((d) =>
        d
          .addOption("paste", "粘贴文本")
          .addOption("vault-file", "Vault 中的单个文件")
          .addOption("vault-folder", "Vault 中的文件夹(每文件=1章)")
          .addOption("local-file", "本地文件(磁盘,.md/.txt)")
          .addOption("local-folder", "本地文件夹(磁盘,每文件=1章)")
          .addOption("current-file", "当前打开的文件")
          .setValue(this.sourceMode)
          .onChange((v) => { this.sourceMode = v as SourceMode; this.render(); })
      );

    if (!isDesktop() && (this.sourceMode === "local-file" || this.sourceMode === "local-folder")) {
      el.createEl("p", {
        text: "本地磁盘读取仅支持桌面端 Obsidian。移动端请改用粘贴文本或 Vault 内文件。",
        cls: "istart-import-warning",
      });
    }

    if (this.sourceMode === "paste") {
      const textarea = el.createEl("textarea", {
        attr: { placeholder: "粘贴原稿全文(支持 第X章 / Chapter N / 数字标题,自动切章)", rows: "12" },
        cls: "istart-question-textarea",
      });
      textarea.value = this.pastedText;
      textarea.addEventListener("input", () => { this.pastedText = textarea.value; });
    } else if (this.sourceMode === "vault-file") {
      new Setting(el)
        .setName("文件路径")
        .setDesc("Vault 内的 .md 或 .txt 文件;支持相对路径与绝对路径,输入时可选下拉")
        .addText((t) => {
          t.setPlaceholder("如 原稿/我的小说.txt")
            .setValue(this.filePath)
            .onChange((v) => { this.filePath = v.trim(); });
          this.fileSuggest?.close();
          this.fileSuggest = new FileSuggest(this.app, t.inputEl, (file) => {
            this.filePath = file.path;
            t.setValue(file.path);
          });
          return t;
        });
    } else if (this.sourceMode === "vault-folder") {
      new Setting(el)
        .setName("文件夹路径")
        .setDesc("文件夹内的 .md/.txt 按名称排序,每文件为一章;支持相对路径与绝对路径")
        .addText((t) => {
          t.setPlaceholder("如 原稿/我的小说")
            .setValue(this.folderPath)
            .onChange((v) => { this.folderPath = v.trim(); });
          this.folderSuggest?.close();
          this.folderSuggest = new FolderSuggest(this.app, t.inputEl, (folder) => {
            this.folderPath = folder.path;
            t.setValue(folder.path);
          });
          return t;
        });
    } else if (this.sourceMode === "local-file") {
      new Setting(el)
        .setName("本地文件路径")
        .setDesc("Vault 之外的磁盘路径(仅桌面端,UTF-8 编码的 .md/.txt)")
        .addText((t) =>
          t.setPlaceholder("如 /Users/dy/Documents/dycn/Writing/原稿.md").setValue(this.localFilePath).onChange((v) => { this.localFilePath = v.trim(); })
        );
    } else if (this.sourceMode === "local-folder") {
      new Setting(el)
        .setName("本地文件夹路径")
        .setDesc("Vault 之外的磁盘文件夹,其中的 .md/.txt 按名称排序,每文件为一章(仅桌面端)")
        .addText((t) =>
          t.setPlaceholder("如 /Users/dy/Documents/dycn/Writing").setValue(this.localFolderPath).onChange((v) => { this.localFolderPath = v.trim(); })
        );
    } else {
      const active = this.app.workspace.getActiveFile();
      const ok = active && SUPPORTED_EXTENSIONS.includes(active.extension);
      el.createEl("p", {
        text: ok
          ? `将导入当前文件:${active.path}`
          : "当前没有打开的 .md/.txt 文件,请先打开一个再回来",
        cls: "istart-diagram-hint",
      });
    }

    this.nav(el, "下一步", () => {
      void this.loadSource().then((ok) => {
        if (ok) { this.step = 2; this.render(); }
      });
    });
  }

  private async loadSource(): Promise<boolean> {
    try {
      if (this.sourceMode === "paste") {
        if (!this.pastedText.trim()) { new Notice("请粘贴原稿文本"); return false; }
        this.rawChapters = new ChapterSplitter().splitText(this.pastedText);
        return true;
      }

      if (this.sourceMode === "vault-file") {
        const resolved = this.resolveVaultPath(this.filePath);
        if (resolved === null) {
          new Notice("文件不在 Vault 内;如原稿在 Vault 外,请改用「本地文件」来源");
          return false;
        }
        const file = this.app.vault.getAbstractFileByPath(resolved);
        if (!(file instanceof TFile)) { new Notice("文件不存在:" + this.filePath); return false; }
        if (!SUPPORTED_EXTENSIONS.includes(file.extension)) {
          new Notice(`仅支持 .md / .txt 文件(当前为 .${file.extension})`);
          return false;
        }
        const content = await this.app.vault.read(file);
        if (!content.trim()) { new Notice("文件内容为空"); return false; }
        this.rawChapters = new ChapterSplitter().splitText(content);
        if (!this.title) this.title = file.basename;
        return true;
      }

      if (this.sourceMode === "vault-folder") {
        const resolved = this.resolveVaultPath(this.folderPath);
        if (resolved === null) {
          new Notice("文件夹不在 Vault 内;如原稿在 Vault 外,请改用「本地文件夹」来源");
          return false;
        }
        const folder = this.app.vault.getAbstractFileByPath(resolved);
        if (!(folder instanceof TFolder)) { new Notice("文件夹不存在:" + this.folderPath); return false; }
        const files: SplitInputFile[] = [];
        for (const child of folder.children) {
          if (child instanceof TFile && SUPPORTED_EXTENSIONS.includes(child.extension)) {
            files.push({ path: child.path, name: child.name, content: await this.app.vault.read(child) });
          }
        }
        if (files.length === 0) { new Notice("文件夹内没有 .md/.txt 文件"); return false; }
        this.rawChapters = new ChapterSplitter().splitFiles(files);
        if (!this.title) this.title = folder.name;
        return true;
      }

      if (this.sourceMode === "local-file") {
        if (!isDesktop()) { new Notice("本地磁盘读取仅支持桌面端 Obsidian"); return false; }
        const content = readLocalFile(this.localFilePath);
        if (content === null) { new Notice("文件不存在或不是文件:" + this.localFilePath); return false; }
        const ext = fileExtensionOf(this.localFilePath);
        if (!SUPPORTED_EXTENSIONS.includes(ext)) { new Notice(`仅支持 .md / .txt 文件(当前为 .${ext})`); return false; }
        if (!content.trim()) { new Notice("文件内容为空"); return false; }
        this.rawChapters = new ChapterSplitter().splitText(content);
        if (!this.title) this.title = basenameOf(this.localFilePath).replace(/\.[^.]+$/, "");
        return true;
      }

      if (this.sourceMode === "local-folder") {
        if (!isDesktop()) { new Notice("本地磁盘读取仅支持桌面端 Obsidian"); return false; }
        const names = listLocalManuscriptFiles(this.localFolderPath);
        if (names.length === 0) { new Notice("文件夹不存在或其中没有 .md/.txt 文件:" + this.localFolderPath); return false; }
        const files: SplitInputFile[] = [];
        for (const name of names) {
          const fullPath = this.localFolderPath.replace(/[\\/]+$/, "") + "/" + name;
          const content = readLocalFile(fullPath);
          if (content !== null) files.push({ path: fullPath, name, content });
        }
        if (files.length === 0) { new Notice("无法读取文件夹内的文件"); return false; }
        this.rawChapters = new ChapterSplitter().splitFiles(files);
        if (!this.title) this.title = basenameOf(this.localFolderPath);
        return true;
      }

      // current-file
      const active = this.app.workspace.getActiveFile();
      if (!active) { new Notice("没有打开的文件"); return false; }
      if (!SUPPORTED_EXTENSIONS.includes(active.extension)) {
        new Notice(`仅支持 .md / .txt 文件(当前为 .${active.extension})`);
        return false;
      }
      const content = await this.app.vault.read(active);
      if (!content.trim()) { new Notice("文件内容为空"); return false; }
      this.rawChapters = new ChapterSplitter().splitText(content);
      if (!this.title) this.title = active.basename;
      return true;
    } catch (err) {
      new Notice(`读取失败:${(err as Error).message}`);
      return false;
    }
  }

  /**
   * 解析输入路径为 Vault 相对路径。
   * 支持:相对路径(原稿/xx.txt)、绝对路径(/Users/.../Vault/原稿/xx.txt)。
   * 绝对路径不在 Vault 内时返回 null。
   */
  private resolveVaultPath(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const adapter = this.app.vault.adapter as import("obsidian").FileSystemAdapter;
    const base = adapter?.getBasePath?.() ?? "";

    const isAbsolute = trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed);
    if (!isAbsolute) return normalizePath(trimmed);

    if (!base) return null; // 无法解析绝对路径(非文件系统适配器)

    const baseNoSlash = base.replace(/[\\/]+$/, "");
    if (trimmed === baseNoSlash) return "";
    const prefix = baseNoSlash + "/";
    if (trimmed.startsWith(prefix)) {
      return normalizePath(trimmed.slice(prefix.length));
    }
    return null; // 不在 Vault 内
  }

  // ── 2. 作品信息 ───────────────────────────────────────────

  private renderInfo(el: HTMLElement) {
    this.stepBar(el);

    new Setting(el)
      .setName("作品名")
      .addText((t) => t.setValue(this.title).onChange((v) => { this.title = v.trim(); }));

    new Setting(el)
      .setName("体裁")
      .setDesc("小说会额外提取角色卡与世界观设定")
      .addDropdown((d) =>
        d
          .addOption("novel", GENRE_LABEL.novel)
          .addOption("paper", GENRE_LABEL.paper)
          .addOption("article", GENRE_LABEL.article)
          .setValue(this.genre)
          .onChange((v) => { this.genre = v as WritingGenre; })
      );

    this.nav(el, "下一步", () => {
      if (!this.title) { new Notice("请填写作品名"); return; }
      this.step = 3;
      this.render();
    });
  }

  // ── 3. 内容归类 ───────────────────────────────────────────

  private renderSplitPreview(el: HTMLElement) {
    this.stepBar(el);

    const chapters = this.rawChapters;
    const chapterCount = chapters.filter((c) => (c.kind ?? "chapter") === "chapter").length;
    const materialCount = chapters.length - chapterCount;

    const singleLarge = chapters.length === 1 && chapters[0].content.length > 30000 && (chapters[0].kind ?? "chapter") === "chapter";
    if (singleLarge) {
      el.createEl("p", {
        text: "未能识别章节标题,全文被当作一章。建议在原稿中插入「## 第N章 章名」标记后重新切分。",
        cls: "istart-import-warning",
      });
    }

    el.createEl("p", {
      text: `识别到 ${chapters.length} 个单元:${chapterCount} 章正文 + ${materialCount} 份资料/设定。当前分类:${this.classifiedBy === "ai" ? "AI 智能识别" : "规则预判"};分类可逐条调整,非正文不会变成章节。`,
      cls: "istart-diagram-hint",
    });

    const aiRow = new Setting(el).setName("AI 智能分类")
      .setDesc("一次批量调用,按内容语义识别正文/大纲/设定/资料/跳过")
      .addButton((btn) =>
        btn.setButtonText(this.classifying ? "分类中..." : "AI 智能分类")
          .setDisabled(this.classifying)
          .onClick(() => { void this.aiClassify(); })
      );
    if (this.classifying) {
      aiRow.descEl.textContent = "AI 正在识别各单元类型...";
    }

    const listEl = el.createDiv({ cls: "istart-import-list" });
    const visible = chapters.slice(0, 80);
    for (let i = 0; i < visible.length; i++) {
      const ch = visible[i];
      const kind = ch.kind ?? "chapter";
      const row = listEl.createDiv({ cls: "istart-import-row" });

      const titleText = kind === "chapter"
        ? `第${ch.number || "?"}章 ${ch.title}`
        : `[${KIND_LABEL[kind]}] ${ch.title}`;
      row.createSpan({ text: titleText, cls: "istart-import-row-title" });
      row.createSpan({ text: `${ch.content.length} 字`, cls: "istart-import-row-count" });

      const kindSelect = row.createEl("select", { cls: "dropdown istart-import-kind" });
      for (const [value, label] of Object.entries(KIND_LABEL)) {
        kindSelect.createEl("option", { text: label, attr: { value } });
      }
      kindSelect.value = kind;
      kindSelect.addEventListener("change", () => {
        ch.kind = kindSelect.value as MaterialKind;
        this.rawChapters = this.renumber(chapters);
        this.render();
      });

      const prev = chapters[i - 1];
      const prevKind = prev?.kind ?? "chapter";
      if (i > 0 && kind === "chapter" && prevKind === "chapter") {
        const btn = row.createEl("button", { text: "合并到上一章", cls: "istart-import-merge" });
        btn.addEventListener("click", () => {
          const merged: RawChapter = {
            number: prev.number,
            title: prev.title,
            content: prev.content + "\n\n" + ch.content,
            kind: "chapter",
          };
          chapters.splice(i - 1, 2, merged);
          this.rawChapters = this.renumber(chapters);
          this.render();
        });
      }
    }
    if (chapters.length > 80) {
      listEl.createEl("p", { text: `… 还有 ${chapters.length - 80} 个单元未显示`, cls: "istart-diagram-hint" });
    }

    this.nav(el, "下一步", () => {
      this.step = 4;
      this.render();
    });
  }

  /** 只给正文章节重编号 */
  private renumber(chapters: RawChapter[]): RawChapter[] {
    let counter = 1;
    return chapters.map((c) => {
      const kind = c.kind ?? "chapter";
      if (kind !== "chapter") return { ...c, number: 0 };
      return { ...c, number: counter++, kind };
    });
  }

  /** AI 批量智能分类,失败保留规则结果 */
  private async aiClassify() {
    if (this.classifying || this.rawChapters.length === 0) return;
    this.classifying = true;
    this.render();

    const notice = new Notice("AI 分类中(约 10-30 秒)...", 0);
    try {
      const classifier = new ImportClassifier(this.settings);
      const units = this.rawChapters.map((c, i) => ({
        index: i,
        title: c.title,
        head: c.content.slice(0, 300),
      }));
      const kinds = await classifier.classifyUnits(units);

      let applied = 0;
      this.rawChapters = this.rawChapters.map((c, i) => {
        const kind = kinds.get(i);
        if (!kind) return c;
        applied++;
        return { ...c, kind };
      });
      this.rawChapters = this.renumber(this.rawChapters);
      this.classifiedBy = "ai";

      notice.hide();
      new Notice(`AI 分类完成:更新 ${applied} 个单元,可在下方手动调整`);
    } catch (err) {
      notice.hide();
      new Notice(`AI 分类失败,保留规则分类:${(err as Error).message}`);
    } finally {
      this.classifying = false;
      this.render();
    }
  }

  // ── 4. 清洗选项 ───────────────────────────────────────────

  private renderCleanOptions(el: HTMLElement) {
    this.stepBar(el);

    new Setting(el)
      .setName("清理防盗水印与站点话术")
      .addToggle((t) => t.setValue(this.cleanOptions.removeWatermarks).onChange((v) => { this.cleanOptions.removeWatermarks = v; }));

    new Setting(el)
      .setName("合并段落内硬换行")
      .setDesc("网文常每句一行,合并后更易阅读")
      .addToggle((t) => t.setValue(this.cleanOptions.mergeHardBreaks).onChange((v) => { this.cleanOptions.mergeHardBreaks = v; }));

    new Setting(el)
      .setName("作者的话")
      .addDropdown((d) =>
        d
          .addOption("keep-callout", "保留为 Callout")
          .addOption("keep-plain", "保留原文")
          .addOption("strip", "剥离")
          .setValue(this.cleanOptions.authorNotes)
          .onChange((v) => { this.cleanOptions.authorNotes = v as CleanOptions["authorNotes"]; })
      );

    this.nav(el, "下一步", () => {
      this.step = 5;
      this.render();
    });
  }

  // ── 5. 执行 ───────────────────────────────────────────────

  private renderExecute(el: HTMLElement) {
    this.stepBar(el);

    const chapterCount = this.rawChapters.filter((c) => (c.kind ?? "chapter") === "chapter").length;
    const materialCount = this.rawChapters.length - chapterCount;

    el.createEl("p", {
      text: `将导入 ${chapterCount} 章正文 + ${materialCount} 份资料(设定→_设定/,大纲与参考→_资料/)到 Writing/${this.genre === "novel" ? "Novels" : this.genre === "paper" ? "Papers" : "Articles"}/${this.title}/。原稿不动,全部复制。AI 将采样前 3 章 + 每 50 章 + 最后一章,反推文风、角色与设定;章节梗概由规则生成。`,
      cls: "istart-diagram-hint",
    });

    this.progressEl = null;
    if (this.progressText) {
      this.progressEl = el.createEl("p", { text: this.progressText, cls: "istart-import-progress" });
    }

    const actionSetting = new Setting(el);
    if (this.running) {
      actionSetting.addButton((btn) =>
        btn.setButtonText("取消导入").onClick(() => {
          this.importManager?.cancel();
          new Notice("已请求取消,正在停止...");
        })
      );
    } else {
      actionSetting
        .addButton((btn) =>
          btn.setButtonText("开始导入").setCta().onClick(() => { void this.runImport(); })
        )
        .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
    }
  }

  // ── 执行 ───────────────────────────────────────────────────

  private async runImport() {
    if (this.running) return;
    this.running = true;
    this.progressText = "清洗文本...";
    this.render();

    const manager = new ImportManager(this.app, this.settings);
    this.importManager = manager;
    try {
      // 1. 清洗
      const cleaner = new TextCleaner();
      const cleaned: RawChapter[] = this.rawChapters.map((c) => ({
        ...c,
        content: cleaner.clean(c.content, this.cleanOptions),
      }));

      // 2. AI 反推元数据(失败不阻断导入)
      this.setProgress("AI 分析中(采样章节,约 30 秒)...");
      const analyzer = new ImportAnalyzer(this.settings);
      const analysis = await analyzer
        .analyze(this.title, this.genre, cleaned)
        .catch(() => EMPTY_ANALYSIS);

      // 3. 落盘
      const file = await manager.run(
        { title: this.title, genre: this.genre, chapters: cleaned, analysis },
        (p) => {
          this.setProgress(`写入章节 ${p.done}/${p.total}:${p.label}`);
        }
      );

      if (file) {
        this.close();
        const chapterCount = cleaned.filter((c) => (c.kind ?? "chapter") === "chapter").length;
        const materialCount = cleaned.filter((c) => c.kind !== undefined && c.kind !== "chapter" && c.kind !== "skip").length;
        new Notice(`导入完成:${this.title}(${chapterCount} 章正文 + ${materialCount} 份资料)`);
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);
      }
    } catch (err) {
      this.running = false;
      new Notice(`导入失败:${(err as Error).message}`);
      this.render();
    }
  }

  private setProgress(text: string) {
    this.progressText = text;
    if (this.progressEl) this.progressEl.textContent = text;
  }
}
