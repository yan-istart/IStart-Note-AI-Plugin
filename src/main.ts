import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, CompletionDepth } from "./types";
import { DeepSeekClient } from "./ai/DeepSeekClient";
import { VaultWriter } from "./vault/VaultWriter";
import { QuestionModal } from "./features/question/QuestionModal";
import { DeepSeekSettingsTab } from "./settings/SettingsTab";
import { ConceptCompleter } from "./ai/ConceptCompleter";
import { ConceptPageManager } from "./features/concept/ConceptPageManager";
import { DepthSelectModal, PreviewModal, BatchScanModal } from "./features/concept/ConceptCompletionModal";
import { QuestionClassifier } from "./ai/QuestionClassifier";
import { QuestionGraphManager } from "./features/question/QuestionGraphManager";
import { QuestionClassifyModal } from "./features/question/QuestionClassifyModal";
import { ContextQAClient } from "./ai/ContextQAClient";
import { ContextQAModal } from "./features/context-qa/ContextQAModal";
import { SectionAppender } from "./ai/SectionAppender";
import { SectionAppendModal, SectionPreviewModal } from "./features/section/SectionAppendModal";
import { BaiduSyncService } from "./features/sync/BaiduSyncService";
import { BaiduAuthModal } from "./features/sync/BaiduAuthModal";
import { BaiduSyncModal } from "./features/sync/BaiduSyncModal";
import { DEFAULT_BAIDU_SYNC_CONFIG } from "./types";
import { BaiduSyncView, SYNC_VIEW_TYPE } from "./features/sync/BaiduSyncView";
import { DiagramGenerator, DiagramType } from "./ai/DiagramGenerator";
import { DiagramTypeModal, DiagramPreviewModal } from "./features/diagram/DiagramModal";
import { SmartCompleter } from "./ai/SmartCompleter";
import { DocumentAnalysisModal, SmartPreviewModal } from "./features/smart-complete/SmartCompleteModal";
import { ReadingPlanner } from "./ai/ReadingPlanner";
import { NewReadingModal, FeynmanModal } from "./features/reading/ReadingModal";
import { ReadingProjectManager } from "./features/reading/ReadingProjectManager";
import { registerAllActions } from "./actions/registry";
import { ALL_ACTIONS } from "./actions/definitions";

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();
    this.registerView(SYNC_VIEW_TYPE, (leaf) => new BaiduSyncView(leaf, this));
    this.addRibbonIcon("cloud", "Baidu cloud sync status", () => { void this.activateSyncView(); });
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
    registerAllActions(this, ALL_ACTIONS);
  }

  // ── 公共方法（供 Action 定义调用） ─────────────────────────

  openQuestionModal() {
    new QuestionModal(this.app, (question) => {
      void this.processQuestion(question);
    }).open();
  }

  openContextQAModal(selectedText: string, sourceNotePath: string) {
    new ContextQAModal(this.app, selectedText, (question) => {
      void this.processContextQA(question, selectedText, sourceNotePath);
    }).open();
  }

  openNewReadingProject() {
    new NewReadingModal(this.app, (bookInfo, toc) => {
      void this.createReadingProject(bookInfo, toc);
    }).open();
  }

  openBaiduSyncModal() {
    if (!this.settings.baiduSync.enabled) { new Notice("请先在设置中启用百度云同步"); return; }
    new BaiduSyncModal(this.app, this.settings.baiduSync, async (accessToken, expiresAt) => {
      this.settings.baiduSync.accessToken = accessToken;
      this.settings.baiduSync.tokenExpiresAt = expiresAt;
      await this.saveSettings();
    }).open();
  }

  openDiagramGenerator(selection: string, context: string, editor: import("obsidian").Editor) {
    new DiagramTypeModal(this.app, (type) => {
      void this.runDiagramGeneration(selection, type, context, editor);
    }).open();
  }

  async completeCurrentConcept() {
    const manager = new ConceptPageManager(this.app, this.settings);
    const info = await manager.analyzeCurrentFile();
    if (!info) { new Notice("当前文件不是概念页"); return; }
    new DepthSelectModal(this.app, info.conceptName, (depth) => {
      void this.runConceptCompletion(info.file, info.conceptName, depth, {
        sourceQuestion: info.sourceQuestion, sourceAnswer: info.sourceAnswer,
      });
    }).open();
  }

  async scanAndBatchComplete() {
    const notice = new Notice("🔍 扫描空概念页中...", 0);
    const manager = new ConceptPageManager(this.app, this.settings);
    const empties = await manager.scanEmptyConcepts();
    notice.hide();
    const items = empties.map((e) => ({ name: e.conceptName, path: e.file.path }));
    new BatchScanModal(this.app, items, (selectedPaths, depth) => {
      void (async () => {
        let done = 0;
        for (const path of selectedPaths) {
          const abstract = this.app.vault.getAbstractFileByPath(path);
          if (!abstract || !(abstract instanceof TFile)) continue;
          const info = await manager.analyzeFile(abstract);
          if (!info) continue;
          const n = new Notice(`⏳ 补全中 (${++done}/${selectedPaths.length})：${info.conceptName}`, 0);
          try {
            const completer = new ConceptCompleter(this.settings);
            const result = await completer.complete(info.conceptName, depth, { sourceQuestion: info.sourceQuestion, sourceAnswer: info.sourceAnswer });
            await manager.writeCompletion(abstract, result, depth);
            n.hide();
          } catch (err) { n.hide(); new Notice(`❌ ${info.conceptName} 补全失败：${(err as Error).message}`); }
        }
        new Notice(`✅ 批量补全完成，共 ${done} 个概念页`);
      })();
    }).open();
  }

  async resumeReadingProject() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开阅读项目的索引页"); return; }
    const meta = this.app.metadataCache.getFileCache(activeFile);
    if (meta?.frontmatter?.type !== "reading-project") { new Notice("当前文件不是阅读项目索引页"); return; }
    const notice = new Notice("⏳ 补全缺失章节...", 0);
    try {
      const manager = new ReadingProjectManager(this.app, this.settings);
      const count = await manager.resumeProject(activeFile, (c, t, ch) => { notice.setMessage(`⏳ 补全 (${c}/${t})：${ch}`); });
      notice.hide();
      new Notice(count === 0 ? "✅ 所有章节已完整" : `✅ 已补全 ${count} 个章节`);
    } catch (err) { notice.hide(); new Notice(`❌ 补全失败：${(err as Error).message}`); }
  }

  async runChapterSummary(editor: import("obsidian").Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开章节笔记"); return; }
    const content = editor.getValue();
    const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
    if (fm?.type !== "reading-note") { new Notice("当前文件不是阅读章节笔记"); return; }
    const book = (fm.book as string) || "未知";
    const chapter = `第${fm.chapter}章：${fm.title}`;
    const questionsMatch = content.match(/## 读前问题\n([\s\S]*?)(?=\n## )/);
    const questions = questionsMatch ? questionsMatch[1].split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.replace(/^- \[.\]\s*/, "").trim()) : [];
    const notice = new Notice("⏳ 生成章节总结...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const result = await planner.summarizeChapter(book, chapter, content, questions);
      notice.hide();
      const manager = new ReadingProjectManager(this.app, this.settings);
      await manager.writeChapterSummary(activeFile, result);
      new Notice("✅ 章节总结已生成");
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(activeFile);
    } catch (err) { notice.hide(); new Notice(`❌ 生成失败：${(err as Error).message}`); }
  }

  async runFeynmanTest(editor: import("obsidian").Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开章节笔记"); return; }
    const content = editor.getValue();
    const fm = this.app.metadataCache.getFileCache(activeFile)?.frontmatter;
    if (fm?.type !== "reading-note") { new Notice("当前文件不是阅读章节笔记"); return; }
    const book = (fm.book as string) || "未知";
    const chapter = `第${fm.chapter}章：${fm.title}`;
    const conceptsMatch = content.match(/## 关联概念\n([\s\S]*?)(?=\n## |$)/);
    const concepts = conceptsMatch ? conceptsMatch[1].match(/\[\[(.+?)\]\]/g)?.map((m) => m.replace(/\[\[|\]\]/g, "")) ?? [] : [];
    const notice = new Notice("⏳ 生成检验问题...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const questions = await planner.feynmanTest(book, chapter, concepts, content);
      notice.hide();
      new FeynmanModal(this.app, chapter, questions).open();
    } catch (err) { notice.hide(); new Notice(`❌ 生成失败：${(err as Error).message}`); }
  }

  async runSmartComplete(editor: import("obsidian").Editor) {
    const selection = editor.getSelection().trim();
    if (selection) { await this.runExpand(selection, editor.getValue().slice(0, 1500), editor); return; }
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const lines = content.split("\n");
    let sectionName: string | null = null;
    let sectionStartLine = -1;
    for (let i = cursor.line; i >= 0; i--) {
      const match = lines[i]?.match(/^##\s+(.+)/);
      if (match) { sectionName = match[1].trim(); sectionStartLine = i; break; }
    }
    if (sectionName && sectionStartLine >= 0) {
      let sectionEmpty = true;
      for (let i = sectionStartLine + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        if (lines[i].trim().length > 0) { sectionEmpty = false; break; }
      }
      if (sectionEmpty) {
        const title = this.app.workspace.getActiveFile()?.basename ?? "未知";
        await this.runSectionComplete(title, sectionName, content, sectionStartLine, editor);
        return;
      }
    }
    const beforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
    await this.runContinue(beforeCursor, editor);
  }

  async runExpand(selection: string, context: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 扩写中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.expand(selection, context);
      notice.hide();
      new SmartPreviewModal(this.app, "扩写预览", result.content, () => { editor.replaceSelection(result.content); new Notice("✅ 已扩写"); }, () => { void this.runExpand(selection, context, editor); }).open();
    } catch (err) { notice.hide(); new Notice(`❌ 扩写失败：${(err as Error).message}`); }
  }

  async runContinue(beforeCursor: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 续写中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.continueWriting(beforeCursor);
      notice.hide();
      new SmartPreviewModal(this.app, "续写预览", result.content, () => { editor.replaceRange("\n" + result.content, editor.getCursor()); new Notice("✅ 已续写"); }, () => { void this.runContinue(beforeCursor, editor); }).open();
    } catch (err) { notice.hide(); new Notice(`❌ 续写失败：${(err as Error).message}`); }
  }

  async runSectionAppend(file: TFile, sectionName: string, content: string) {
    const appender = new SectionAppender(this.app, this.settings);
    const section = appender.extractSection(content, sectionName);
    const existingItems = section?.existing.split("\n").filter((l) => l.trim().startsWith("-")).length ?? 0;
    const meta = this.app.metadataCache.getFileCache(file);
    const conceptName = (meta?.frontmatter?.name as string) || file.basename;
    new SectionAppendModal(this.app, sectionName, existingItems, (count) => {
      void this.generateAndPreviewSection(file, conceptName, sectionName, section?.existing ?? "", count);
    }).open();
  }

  async runDocumentAnalysis(content: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 分析文档中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const suggestions = await completer.analyzeDocument(content);
      notice.hide();
      new DocumentAnalysisModal(this.app, suggestions, (selected) => {
        const parts = selected.map((s) => `## ${s.section}\n${s.content}`);
        const insertText = "\n\n" + parts.join("\n\n") + "\n";
        const lastLine = editor.lastLine();
        editor.replaceRange(insertText, { line: lastLine, ch: editor.getLine(lastLine).length });
        new Notice(`✅ 已插入 ${selected.length} 处补充内容`);
      }).open();
    } catch (err) { notice.hide(); new Notice(`❌ 分析失败：${(err as Error).message}`); }
  }

  async runDiagramGeneration(selection: string, type: DiagramType, context: string, editor: import("obsidian").Editor) {
    const notice = new Notice(`⏳ 生成图表中...`, 0);
    try {
      const generator = new DiagramGenerator(this.settings);
      const result = await generator.generate(selection, type, context);
      notice.hide();
      const formatted = generator.formatForInsert(result);
      new DiagramPreviewModal(this.app, result, formatted,
        () => { const cursor = editor.getCursor("to"); editor.replaceRange(`\n${formatted}\n`, { line: cursor.line + 1, ch: 0 }); new Notice(`✅ 已插入${result.typeName}`); },
        () => { void this.runDiagramGeneration(selection, type, context, editor); },
        (instruction) => { void this.runDiagramRefine(result.code, instruction, editor); }
      ).open();
    } catch (err) { notice.hide(); new Notice(`❌ 生成失败：${(err as Error).message}`); }
  }

  // ── 私有方法 ───────────────────────────────────────────────

  private async processContextQA(question: string, context: string, sourceNotePath: string) {
    const notice = new Notice("⏳ 基于上下文思考中...", 0);
    try {
      const client = new ContextQAClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);
      let surroundingContext: string | undefined;
      if (sourceNotePath) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourceNotePath);
        if (sourceFile instanceof TFile) { surroundingContext = (await this.app.vault.read(sourceFile)).slice(0, 500); }
      }
      const [response, history] = await Promise.all([client.ask({ question, context, sourceNote: sourceNotePath, surroundingContext }), Promise.resolve(graphManager.getQuestionHistory())]);
      notice.hide();
      const classifier = new QuestionClassifier(this.settings);
      const classifyNotice = new Notice("🔍 分析问题关系...", 0);
      const classification = await classifier.classify(question, history);
      classifyNotice.hide();
      new QuestionClassifyModal(this.app, question, classification, (confirmed) => {
        void (async () => {
          const writeNotice = new Notice("✍️ 写入笔记...", 0);
          try {
            const writer = new VaultWriter(this.app, this.settings);
            const file = await writer.writeContextQANote({ question, context, sourceNote: sourceNotePath, surroundingContext }, response);
            await graphManager.attachClassification(file, question, confirmed, response.concepts);
            await graphManager.appendRecommendations(file, confirmed);
            await graphManager.updateQuestionIndex(question, confirmed, file.path);
            writeNotice.hide();
            new Notice(`✅ 上下文笔记已生成：${file.name}`);
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            void this.triggerAutoBackup(file.path);
          } catch (err) { writeNotice.hide(); new Notice(`❌ 写入失败：${(err as Error).message}`); }
        })();
      }).open();
    } catch (err) { notice.hide(); new Notice(`❌ 错误：${(err as Error).message}`); }
  }

  private async processQuestion(question: string) {
    const notice = new Notice("⏳ DeepSeek 思考中...", 0);
    try {
      const client = new DeepSeekClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);
      const [response, history] = await Promise.all([client.ask(question), Promise.resolve(graphManager.getQuestionHistory())]);
      notice.hide();
      const classifier = new QuestionClassifier(this.settings);
      const classifyNotice = new Notice("🔍 分析问题关系...", 0);
      const classification = await classifier.classify(question, history);
      classifyNotice.hide();
      new QuestionClassifyModal(this.app, question, classification, (confirmed) => {
        void (async () => {
          const writeNotice = new Notice("✍️ 写入笔记...", 0);
          try {
            const writer = new VaultWriter(this.app, this.settings);
            const file = await writer.writeQANote(question, response);
            await graphManager.attachClassification(file, question, confirmed, response.concepts);
            await graphManager.appendRecommendations(file, confirmed);
            await graphManager.updateQuestionIndex(question, confirmed, file.path);
            writeNotice.hide();
            new Notice(`✅ 笔记已生成：${file.name}`);
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
            if (this.settings.autoOpenGraph) {
              const appCmd = this.app as unknown as { commands: { executeCommandById: (id: string) => void } };
              appCmd.commands.executeCommandById("graph:open");
            }
            void this.triggerAutoBackup(file.path);
          } catch (err) { writeNotice.hide(); new Notice(`❌ 写入失败：${(err as Error).message}`); }
        })();
      }).open();
    } catch (err) { notice.hide(); new Notice(`❌ 错误：${(err as Error).message}`); }
  }

  private async runConceptCompletion(file: TFile, conceptName: string, depth: CompletionDepth, context: { sourceQuestion?: string; sourceAnswer?: string }) {
    const notice = new Notice(`⏳ 正在补全概念：${conceptName}...`, 0);
    try {
      const completer = new ConceptCompleter(this.settings);
      const result = await completer.complete(conceptName, depth, context);
      notice.hide();
      const manager = new ConceptPageManager(this.app, this.settings);
      const previewMd = manager.buildPreviewMarkdown(result, depth);
      new PreviewModal(this.app, conceptName, previewMd,
        () => { void (async () => { await manager.writeCompletion(file, result, depth); new Notice(`✅ 概念页已补全：${conceptName}`); const leaf = this.app.workspace.getLeaf(false); await leaf.openFile(file); })(); },
        () => { void this.runConceptCompletion(file, conceptName, depth, context); }
      ).open();
    } catch (err) { notice.hide(); new Notice(`❌ 补全失败：${(err as Error).message}`); }
  }

  private async generateAndPreviewSection(file: TFile, conceptName: string, sectionName: string, existingContent: string, count: number) {
    const notice = new Notice(`⏳ 生成"${sectionName}"补充内容...`, 0);
    try {
      const appender = new SectionAppender(this.app, this.settings);
      const result = await appender.generate(conceptName, sectionName, existingContent, count);
      notice.hide();
      new SectionPreviewModal(this.app, sectionName, result.items,
        () => { void (async () => { await appender.appendToSection(file, sectionName, result.items); new Notice(`✅ 已追加 ${result.items.length} 条`); })(); },
        () => { void this.generateAndPreviewSection(file, conceptName, sectionName, existingContent, count); }
      ).open();
    } catch (err) { notice.hide(); new Notice(`❌ 生成失败：${(err as Error).message}`); }
  }

  private async runSectionComplete(title: string, sectionName: string, fileContent: string, sectionStartLine: number, editor: import("obsidian").Editor) {
    const notice = new Notice(`⏳ 补全"${sectionName}"...`, 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.completeSection(title, sectionName, fileContent);
      notice.hide();
      new SmartPreviewModal(this.app, `补全"${sectionName}"`, result.content,
        () => { editor.replaceRange(result.content + "\n\n", { line: sectionStartLine + 1, ch: 0 }); new Notice(`✅ 已补全"${sectionName}"`); },
        () => { void this.runSectionComplete(title, sectionName, fileContent, sectionStartLine, editor); }
      ).open();
    } catch (err) { notice.hide(); new Notice(`❌ 补全失败：${(err as Error).message}`); }
  }

  private async createReadingProject(bookInfo: string, toc?: string) {
    const notice = new Notice("⏳ 生成全书骨架...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const plan = await planner.planSkeleton(bookInfo, toc);
      notice.setMessage(`✍️ 创建项目结构（${plan.chapters.length} 章）...`);
      const manager = new ReadingProjectManager(this.app, this.settings);
      const indexFile = await manager.createProject(plan, (c, t, ch) => { notice.setMessage(`⏳ 生成预设问题 (${c}/${t})：${ch}`); });
      notice.hide();
      new Notice(`✅ 阅读项目已创建：${plan.bookTitle}（${plan.chapters.length} 章）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(indexFile);
    } catch (err) { notice.hide(); new Notice(`❌ 创建失败：${(err as Error).message}`); }
  }

  private async runDiagramRefine(existingCode: string, instruction: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 优化图表中...", 0);
    try {
      const generator = new DiagramGenerator(this.settings);
      const result = await generator.refine(existingCode, instruction);
      notice.hide();
      const formatted = generator.formatForInsert(result);
      new DiagramPreviewModal(this.app, result, formatted,
        () => { editor.replaceRange(`\n${formatted}\n`, { line: editor.getCursor("to").line + 1, ch: 0 }); new Notice(`✅ 已插入`); },
        () => { void this.runDiagramRefine(existingCode, instruction, editor); },
        (newInst) => { void this.runDiagramRefine(result.code, newInst, editor); }
      ).open();
    } catch (err) { notice.hide(); new Notice(`❌ 优化失败：${(err as Error).message}`); }
  }

  private async activateSyncView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SYNC_VIEW_TYPE)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true); await leaf.setViewState({ type: SYNC_VIEW_TYPE, active: true }); }
    await workspace.revealLeaf(leaf);
  }

  private async triggerAutoBackup(filePath: string) {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.autoBackup || !cfg.accessToken) return;
    try {
      const service = new BaiduSyncService(this.app, cfg);
      const tokenOk = await service.ensureValidToken();
      if (!tokenOk) return;
      const folder = filePath.includes("/") ? filePath.substring(0, filePath.lastIndexOf("/")) : "";
      await service.backup(folder);
    } catch { /* silent */ }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.baiduSync = Object.assign({}, DEFAULT_BAIDU_SYNC_CONFIG, this.settings.baiduSync);
    if (this.settings.baiduSync.enabled && this.settings.baiduSync.accessToken) { void this.pullConfig(true); }
  }

  async saveSettings() { await this.saveData(this.settings); }

  async pushConfig() {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) { new Notice("请先启用百度云同步并完成授权"); return; }
    const service = new BaiduSyncService(this.app, cfg);
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const ok = await service.pushConfig(this.settings, adapter.basePath ?? "unknown-device");
    new Notice(ok ? "✅ 配置已推送到百度云" : "❌ 配置推送失败");
  }

  async pullConfig(silent = false) {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) return;
    const service = new BaiduSyncService(this.app, cfg);
    const remote = await service.pullConfig(undefined);
    if (!remote) { if (!silent) new Notice("远端无配置或已是最新"); return; }
    this.settings = BaiduSyncService.applyRemoteConfig(this.settings, remote);
    await this.saveData(this.settings);
    if (!silent) new Notice(`✅ 已从百度云拉取配置`);
  }
}
