import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, CompletionDepth } from "./types";
import { DeepSeekSettingsTab } from "./settings/SettingsTab";
import { BaiduSyncService } from "./features/sync/BaiduSyncService";
import { BaiduSyncModal } from "./features/sync/BaiduSyncModal";
import { BaiduSyncView, SYNC_VIEW_TYPE } from "./features/sync/BaiduSyncView";
import { DEFAULT_BAIDU_SYNC_CONFIG } from "./types";
import { AIAssistant, AssistantContext, AssistantResult } from "./ai/AIAssistant";
import { AssistantInputModal, AssistantResultModal } from "./features/assistant/AssistantModal";
import { ReadingPlanner } from "./ai/ReadingPlanner";
import { NewReadingModal } from "./features/reading/ReadingModal";
import { ReadingProjectManager } from "./features/reading/ReadingProjectManager";
import { SectionAppender } from "./ai/SectionAppender";
import { MarkdownBeautifier } from "./ai/formatter/MarkdownBeautifier";
import { registerAllActions } from "./actions/registry";
import { ALL_ACTIONS } from "./actions/definitions";
import { ConceptCompleter } from "./ai/ConceptCompleter";
import { ConceptPageManager } from "./features/concept/ConceptPageManager";
import { DepthSelectModal, PreviewModal, BatchScanModal } from "./features/concept/ConceptCompletionModal";
import { QuestionClassifier } from "./ai/QuestionClassifier";
import { QuestionGraphManager } from "./features/question/QuestionGraphManager";
import { DeepSeekClient } from "./ai/DeepSeekClient";
import { VaultWriter } from "./vault/VaultWriter";
import { QuestionModal } from "./features/question/QuestionModal";
import { QuestionClassifyModal } from "./features/question/QuestionClassifyModal";
import { KnowledgeDebtModal } from "./features/dashboard/KnowledgeDebtModal";
import { SCHEMA_VERSION, todayIso } from "./core/schema";
import { KnowledgeIndexService } from "./core/knowledge";
import { PlanBuilder } from "./core/execution";
import { PlanExecutor } from "./core/execution";
import { ScheduledTaskRunner, ScheduledTaskConfig } from "./core/scheduler";

export default class DeepSeekPlugin extends Plugin {
  settings!: DeepSeekSettings;
  /** In-memory vault knowledge index, rebuilt on load, updated incrementally. */
  knowledgeIndex!: KnowledgeIndexService;
  /** Scheduled task runner — only active while Obsidian is open. */
  private scheduler: ScheduledTaskRunner | null = null;

  async onload() {
    await this.loadSettings();

    // Build knowledge index
    this.knowledgeIndex = new KnowledgeIndexService(this.app);
    this.app.workspace.onLayoutReady(() => {
      this.knowledgeIndex.rebuild();
      this.startScheduler();
    });
    // Incremental updates
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.knowledgeIndex.updateFile(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.knowledgeIndex.removeFile(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.knowledgeIndex.removeFile(oldPath);
        if (file instanceof TFile) this.knowledgeIndex.updateFile(file);
      })
    );

    this.registerView(SYNC_VIEW_TYPE, (leaf) => new BaiduSyncView(leaf, this));
    this.addRibbonIcon("cloud", "Baidu cloud sync", () => { void this.activateSyncView(); });
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
    registerAllActions(this, ALL_ACTIONS);
  }

  // ── AI 助手（统一入口） ────────────────────────────────────

  openAssistant() {
    const editor = this.app.workspace.activeEditor?.editor ?? null;
    const activeFile = this.app.workspace.getActiveFile();
    const selection = editor?.getSelection().trim() ?? "";
    const fileName = activeFile?.basename ?? "";
    const fileMeta = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const fileType = fileMeta?.frontmatter?.type as string | undefined;

    // 构建上下文提示
    const hints: string[] = [];
    if (selection) hints.push(`📎 已选中 ${selection.length} 字`);
    if (fileName) hints.push(`📄 ${fileName}`);
    const contextHint = hints.join("  |  ");

    new AssistantInputModal(this.app, contextHint, (instruction) => {
      void this.runAssistant(instruction);
    }).open();
  }

  private async runAssistant(instruction: string) {
    const editor = this.app.workspace.activeEditor?.editor ?? null;
    const activeFile = this.app.workspace.getActiveFile();
    const selection = editor?.getSelection().trim() ?? "";
    const fileContent = editor?.getValue() ?? "";
    const fileName = activeFile?.basename ?? "";
    const fileMeta = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const fileType = fileMeta?.frontmatter?.type as string | undefined;

    // 计算光标上下文
    let cursorLineBefore = "";
    let sectionName: string | null = null;
    let sectionEmpty = false;

    if (editor) {
      const cursor = editor.getCursor();
      cursorLineBefore = editor.getRange({ line: 0, ch: 0 }, cursor);

      const lines = fileContent.split("\n");
      let sectionStartLine = -1;
      for (let i = cursor.line; i >= 0; i--) {
        const match = lines[i]?.match(/^##\s+(.+)/);
        if (match) { sectionName = match[1].trim(); sectionStartLine = i; break; }
      }
      if (sectionName && sectionStartLine >= 0) {
        sectionEmpty = true;
        for (let i = sectionStartLine + 1; i < lines.length; i++) {
          if (/^##\s/.test(lines[i])) break;
          if (lines[i].trim().length > 0) { sectionEmpty = false; break; }
        }
      }
    }

    const ctx: AssistantContext = {
      selection,
      fileContent,
      fileName,
      fileType,
      cursorLineBefore,
      sectionName,
      sectionEmpty,
    };

    const notice = new Notice("⏳ AI 思考中...", 0);
    try {
      const knownConcepts = this.getKnownConcepts();
      const style = this.settings.outputStyle ?? "knowledge-base";
      const assistant = new AIAssistant(this.settings, style, knownConcepts);
      const result = await assistant.run(instruction, ctx);
      notice.hide();

      new AssistantResultModal(
        this.app,
        result,
        () => this.applyResult(result, editor),
        () => { void this.runAssistant(instruction); },
        () => { void this.createConceptFromContent(result.content, ctx.selection); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ ${(err as Error).message}`);
    }
  }

  private applyResult(result: AssistantResult, editor: import("obsidian").Editor | null) {
    if (!editor) { new Notice("无法写入：编辑器不可用"); return; }

    switch (result.mode) {
      case "replace":
        editor.replaceSelection(result.content);
        new Notice("✅ 已替换");
        break;
      case "insert": {
        const cursor = editor.getCursor();
        editor.replaceRange("\n" + result.content + "\n", cursor);
        new Notice("✅ 已插入");
        break;
      }
      case "append": {
        const lastLine = editor.lastLine();
        editor.replaceRange("\n\n" + result.content + "\n", { line: lastLine, ch: editor.getLine(lastLine).length });
        new Notice("✅ 已追加");
        break;
      }
      case "show":
        // 用户选择"插入到文档"时，当作 insert 处理
        {
          const cursor = editor.getCursor();
          editor.replaceRange("\n" + result.content + "\n", cursor);
          new Notice("✅ 已插入");
        }
        break;
    }

    // 所有模式都自动创建概念页
    void this.ensureLinkedConcepts(result.content);
  }

  /** 将 AI 生成的内容创建为新概念页 */
  private async createConceptFromContent(content: string, conceptName: string) {
    const name = conceptName.trim().replace(/\[\[|\]\]/g, "") || "新概念";
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    const uncategorizedPath = normalizePath(`${conceptsPath}/_未分类`);

    // 记录发起页面（必须在切换文件之前）
    const sourceFile = this.app.workspace.getActiveFile();
    const sourcePath = sourceFile?.path ?? "";

    // 1. 先在原文档中把选中词替换为 [[双链]]
    if (sourceFile && name) {
      const sourceContent = await this.app.vault.read(sourceFile);
      const escaped = this.escapeRegex(name);
      const linked = sourceContent.replace(
        new RegExp(`(?<!\\[\\[)${escaped}(?!\\]\\])`, "g"),
        `[[${name}]]`
      );
      if (linked !== sourceContent) {
        await this.app.vault.modify(sourceFile, linked);
      }
    }

    // 2. 创建概念页
    if (!this.app.vault.getAbstractFileByPath(uncategorizedPath)) {
      try { await this.app.vault.createFolder(uncategorizedPath); } catch { /* exists */ }
    }

    const filePath = normalizePath(`${uncategorizedPath}/${name}.md`);
    const sourceLink = sourcePath ? `\n\n## 来源\n\n- [[${sourcePath}]]\n` : "";

    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      const oldContent = await this.app.vault.read(existing);
      // 追加内容 + 来源（避免重复来源）
      const appendSource = oldContent.includes(`[[${sourcePath}]]`) ? "" : sourceLink;
      await this.app.vault.modify(existing, oldContent.trimEnd() + "\n\n" + content + appendSource);
      new Notice(`✅ 已追加到概念页：${name}`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(existing);
    } else if (existing) {
      // 路径被非 markdown 文件占用，安全降级：换名
      const altPath = await this.findFreePath(uncategorizedPath, name);
      const today = todayIso();
      const fullContent = `---\ntype: concept\nschema_version: ${SCHEMA_VERSION}\nname: ${name}\nstatus: completed\ncreated_from: ai-assistant\nsource: "[[${sourcePath}]]"\ncreated_at: ${today}\n---\n\n# ${name}\n\n${content}${sourceLink}`;
      const file = await this.app.vault.create(altPath, fullContent);
      new Notice(`✅ 已创建概念页：${file.basename}（原路径被占用，已自动换名）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } else {
      const today = todayIso();
      const fullContent = `---\ntype: concept\nschema_version: ${SCHEMA_VERSION}\nname: ${name}\nstatus: completed\ncreated_from: ai-assistant\nsource: "[[${sourcePath}]]"\ncreated_at: ${today}\n---\n\n# ${name}\n\n${content}${sourceLink}`;
      const file = await this.app.vault.create(filePath, fullContent);
      new Notice(`✅ 已创建概念页：${name}（原文已建立链接）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }

    // 3. 创建内容中引用的其他概念页
    void this.ensureLinkedConcepts(content);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** 找一个未被占用的概念页路径（追加 -2、-3 ...） */
  private async findFreePath(folder: string, baseName: string): Promise<string> {
    let candidate = normalizePath(`${folder}/${baseName}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${baseName}-${suffix}.md`);
      suffix++;
    }
    return candidate;
  }

  /** 扫描内容中の [[双链]]，为不存在的概念自动创建页面 */
  private async ensureLinkedConcepts(content: string) {
    const links = content.match(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g);
    if (!links) return;

    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    const uncategorizedPath = normalizePath(`${conceptsPath}/_未分类`);

    const conceptNames = links
      .map((l) => l.replace(/\[\[|\]\]/g, "").split("|")[0].trim())
      .filter((name) => name.length >= 2);

    // 去重
    const unique = [...new Set(conceptNames)];
    let created = 0;

    for (const concept of unique) {
      // 检查是否已存在
      const existing = this.app.vault.getMarkdownFiles().find(
        (f) => f.path.startsWith(conceptsPath) && f.basename === concept
      );
      if (existing) continue;

      // 确保目录存在
      if (!this.app.vault.getAbstractFileByPath(uncategorizedPath)) {
        try { await this.app.vault.createFolder(uncategorizedPath); } catch { /* exists */ }
      }

      const filePath = normalizePath(`${uncategorizedPath}/${concept}.md`);
      if (this.app.vault.getAbstractFileByPath(filePath)) continue;

      const today = todayIso();
      await this.app.vault.create(filePath,
        `---\ntype: concept\nschema_version: ${SCHEMA_VERSION}\nname: ${concept}\nstatus: empty\ncompletion_status: pending\ncreated_from: ai-assistant\ncreated_at: ${today}\n---\n\n# ${concept}\n\n## 定义\n\n## 核心解释\n\n## 示例\n\n## 关联概念\n\n## 相关问题\n`
      );
      created++;
    }

    if (created > 0) {
      new Notice(`📝 已创建 ${created} 个新概念页`);
    }
  }

  // ── 概念页补全 ─────────────────────────────────────────────

  /** 补全当前打开的概念页 */
  openCompleteCurrentConcept() {
    const manager = new ConceptPageManager(this.app, this.settings);
    void (async () => {
      const info = await manager.analyzeCurrentFile();
      if (!info) { new Notice("当前文件不是概念页"); return; }
      if (!info.isEmpty) { new Notice(`概念页"${info.conceptName}"已有内容，无需补全`); return; }

      new DepthSelectModal(this.app, info.conceptName, (depth) => {
        void this.runConceptCompletion(info.file, info.conceptName, depth, {
          sourceQuestion: info.sourceQuestion,
          sourceAnswer: info.sourceAnswer,
        });
      }).open();
    })();
  }

  /** 扫描所有空概念页并批量补全 */
  openScanEmptyConcepts() {
    const manager = new ConceptPageManager(this.app, this.settings);
    void (async () => {
      const notice = new Notice("⏳ 扫描空概念页...", 0);
      const emptyConcepts = await manager.scanEmptyConcepts();
      notice.hide();

      const items = emptyConcepts.map((c) => ({ name: c.conceptName, path: c.file.path }));
      new BatchScanModal(this.app, items, (selectedPaths, depth) => {
        void this.batchCompleteConcepts(selectedPaths, depth);
      }).open();
    })();
  }

  private async runConceptCompletion(
    file: TFile,
    conceptName: string,
    depth: CompletionDepth,
    context: { sourceQuestion?: string; sourceAnswer?: string }
  ) {
    const notice = new Notice(`⏳ 正在补全"${conceptName}"...`, 0);
    try {
      const completer = new ConceptCompleter(this.settings);
      const relatedConcepts = this.getKnownConcepts().filter((c) => c !== conceptName).slice(0, 10);
      const result = await completer.complete(conceptName, depth, {
        ...context,
        relatedConcepts,
      });
      notice.hide();

      const manager = new ConceptPageManager(this.app, this.settings);
      const previewMd = manager.buildPreviewMarkdown(result, depth);

      new PreviewModal(
        this.app,
        conceptName,
        previewMd,
        () => {
          void (async () => {
            await manager.writeCompletion(file, result, depth);
            new Notice(`✅ 概念页"${conceptName}"补全完成`);
          })();
        },
        () => { void this.runConceptCompletion(file, conceptName, depth, context); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 补全失败：${(err as Error).message}`);
    }
  }

  private async batchCompleteConcepts(paths: string[], depth: CompletionDepth) {
    const manager = new ConceptPageManager(this.app, this.settings);
    let done = 0;
    const total = paths.length;

    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || !(file instanceof TFile)) continue;

      const info = await manager.analyzeFile(file);
      if (!info || !info.isEmpty) continue;

      const notice = new Notice(`⏳ (${done + 1}/${total}) 补全"${info.conceptName}"...`, 0);
      try {
        const completer = new ConceptCompleter(this.settings);
        const relatedConcepts = this.getKnownConcepts().filter((c) => c !== info.conceptName).slice(0, 10);
        const result = await completer.complete(info.conceptName, depth, {
          sourceQuestion: info.sourceQuestion,
          sourceAnswer: info.sourceAnswer,
          relatedConcepts,
        });
        await manager.writeCompletion(file, result, depth);
        done++;
        notice.hide();
      } catch (err) {
        notice.hide();
        new Notice(`❌ "${info.conceptName}"补全失败：${(err as Error).message}`);
      }
    }

    new Notice(`✅ 批量补全完成：${done}/${total}`);
  }

  // ── 知识提问（带问题图谱） ─────────────────────────────────

  /** 提问入口：问题分类 → Q&A 生成 → 图谱更新 */
  openQuestionWithGraph() {
    new QuestionModal(this.app, (question) => {
      void this.askWithGraph(question);
    }).open();
  }

  private async askWithGraph(question: string) {
    const notice = new Notice("⏳ AI 思考中...", 0);
    try {
      // 1. 问题分类
      const graphManager = new QuestionGraphManager(this.app, this.settings);
      const history = graphManager.getQuestionHistory();
      const classifier = new QuestionClassifier(this.settings);
      const classification = await classifier.classify(question, history);

      notice.hide();

      // 2. 让用户确认/修改分类
      new QuestionClassifyModal(this.app, question, classification, (finalClassification) => {
        void this.generateQAWithGraph(question, finalClassification);
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ ${(err as Error).message}`);
    }
  }

  private async generateQAWithGraph(question: string, classification: import("./types").QuestionClassification) {
    const notice = new Notice("⏳ 生成 Q&A 笔记...", 0);
    try {
      // 1. 调用 DeepSeek 获取答案
      const client = new DeepSeekClient(this.settings);
      const response = await client.ask(question);

      // 2. 写入 Q&A 笔记
      const writer = new VaultWriter(this.app, this.settings);
      const file = await writer.writeQANote(question, response);

      // 3. 附加分类 frontmatter
      const graphManager = new QuestionGraphManager(this.app, this.settings);
      await graphManager.attachClassification(file, question, classification, response.concepts);

      // 4. 更新问题索引
      await graphManager.updateQuestionIndex(question, classification, file.path);

      // 5. 追加推荐问题
      await graphManager.appendRecommendations(file, classification);

      notice.hide();
      new Notice(`✅ 已生成 Q&A：${question.slice(0, 30)}...`);

      // 打开生成的笔记
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (err) {
      notice.hide();
      new Notice(`❌ ${(err as Error).message}`);
    }
  }

  // ── 知识债务看板 ─────────────────────────────────────────────

  openKnowledgeDebt() {
    new KnowledgeDebtModal(this.app, this.knowledgeIndex, (actionId, entries) => {
      if (actionId === "complete-concepts") {
        const paths = entries.map((e) => e.path).slice(0, 5);
        void this.batchCompleteConcepts(paths, "standard");
      }
      // future: classify-questions
    }).open();
  }

  // ── 知识库问答（带来源引用） ─────────────────────────────────

  /**
   * "Ask your vault" — uses KnowledgeIndex to find relevant notes,
   * then sends them as context so the AI can answer with source references.
   */
  openVaultQA() {
    const editor = this.app.workspace.activeEditor?.editor ?? null;
    const selection = editor?.getSelection().trim() ?? "";
    const activeFile = this.app.workspace.getActiveFile();
    const contextHint = selection
      ? `📎 已选中 ${selection.length} 字`
      : activeFile
      ? `📄 ${activeFile.basename}`
      : "";

    new AssistantInputModal(this.app, `[知识库问答] ${contextHint}`, (instruction) => {
      void this.runVaultQA(instruction, selection, activeFile);
    }).open();
  }

  private async runVaultQA(question: string, selection: string, activeFile: TFile | null) {
    const notice = new Notice("⏳ 检索知识库并生成回答...", 0);
    const currentEditor = this.app.workspace.activeEditor?.editor ?? null;
    try {
      // 1. Search index for relevant entries
      const results = this.knowledgeIndex.search(question, {
        limit: 8,
        contextFile: activeFile?.path,
      });

      // 2. Build context from retrieved entries
      const contextParts: string[] = [];
      const sourceFiles: { path: string; title: string }[] = [];

      for (const { entry } of results) {
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!file || !(file instanceof TFile)) continue;

        const content = await this.app.vault.cachedRead(file);
        // Take first 600 chars per file to keep context manageable
        const snippet = content.slice(0, 600).trim();
        contextParts.push(`--- 来源：[[${entry.basename}]] (${entry.type ?? "note"}) ---\n${snippet}`);
        sourceFiles.push({ path: entry.path, title: entry.title });
      }

      const knowledgeContext = contextParts.join("\n\n");

      // 3. Build prompt that instructs citing sources
      const systemPrompt = `你是一个基于用户个人知识库的问答助手。以下是从用户知识库中检索到的相关笔记片段。请基于这些内容回答问题，并在回答中引用来源（使用 [[笔记名]] 双链格式）。

如果知识库内容不足以回答，你可以补充通用知识，但必须标注哪些是来自知识库、哪些是模型推断。

检索到的知识库内容：
${knowledgeContext}

${selection ? `用户当前选中的文字：\n${selection}\n` : ""}`;

      const userPrompt = question;

      // 4. Call AI
      const { LLMClient } = await import("./core/llm");
      const llm = new LLMClient(this.settings);
      const raw = await llm.chat({ systemPrompt, userPrompt, temperature: 0.5 });

      // 5. Post-process: beautify + auto-link
      const knownConcepts = this.getKnownConcepts();
      const style = this.settings.outputStyle ?? "knowledge-base";
      const assistant = new AIAssistant(this.settings, style, knownConcepts);
      const beautified = assistant.beautifyContent(raw);

      // 6. Append source section
      const sourcesSection = sourceFiles.length > 0
        ? `\n\n---\n\n## 依据来源\n\n${sourceFiles.map((s) => `- [[${s.title}]]`).join("\n")}\n`
        : "";
      const finalContent = beautified + sourcesSection;

      notice.hide();

      new AssistantResultModal(
        this.app,
        { mode: "show", content: finalContent, explanation: `知识库问答（引用 ${sourceFiles.length} 篇笔记）` },
        () => {
          if (!currentEditor) { new Notice("无法写入：编辑器不可用"); return; }
          const cursor = currentEditor.getCursor();
          currentEditor.replaceRange("\n" + finalContent + "\n", cursor);
          new Notice("✅ 已插入");
        },
        () => { void this.runVaultQA(question, selection, activeFile); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ ${(err as Error).message}`);
    }
  }

  // ── 阅读项目 ───────────────────────────────────────────────

  openNewReadingProject() {
    new NewReadingModal(this.app, (bookInfo, toc) => {
      void this.createReadingProject(bookInfo, toc);
    }).open();
  }

  private async createReadingProject(bookInfo: string, toc?: string) {
    const notice = new Notice("⏳ 生成全书骨架...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const plan = await planner.planSkeleton(bookInfo, toc);
      notice.setMessage(`✍️ 创建项目结构（${plan.chapters.length} 章）...`);
      const manager = new ReadingProjectManager(this.app, this.settings);
      const indexFile = await manager.createProject(plan, (c, t, ch) => {
        notice.setMessage(`⏳ 生成预设问题 (${c}/${t})：${ch}`);
      });
      notice.hide();
      new Notice(`✅ 阅读项目已创建：${plan.bookTitle}（${plan.chapters.length} 章）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(indexFile);
    } catch (err) {
      notice.hide();
      new Notice(`❌ 创建失败：${(err as Error).message}`);
    }
  }

  // ── 百度云同步 ─────────────────────────────────────────────

  openBaiduSyncModal() {
    if (!this.settings.baiduSync.enabled) { new Notice("请先在设置中启用百度云同步"); return; }
    new BaiduSyncModal(this.app, this.settings.baiduSync, async (accessToken, expiresAt) => {
      this.settings.baiduSync.accessToken = accessToken;
      this.settings.baiduSync.tokenExpiresAt = expiresAt;
      await this.saveSettings();
    }).open();
  }

  private async activateSyncView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SYNC_VIEW_TYPE)[0];
    if (!leaf) { leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true); await leaf.setViewState({ type: SYNC_VIEW_TYPE, active: true }); }
    await workspace.revealLeaf(leaf);
  }

  /** 美化当前文档 */
  async beautifyCurrentNote() {
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) { new Notice("请先打开一个文件"); return; }

    const content = editor.getValue();
    if (!content.trim()) { new Notice("文档为空"); return; }

    const notice = new Notice("⏳ AI 正在重新组织文档结构...", 0);
    try {
      const knownConcepts = this.getKnownConcepts();
      const style = this.settings.outputStyle ?? "knowledge-base";
      const assistant = new AIAssistant(this.settings, style, knownConcepts);

      const ctx: AssistantContext = {
        selection: "",
        fileContent: content,
        fileName: this.app.workspace.getActiveFile()?.basename ?? "",
        fileType: undefined,
        cursorLineBefore: "",
        sectionName: null,
        sectionEmpty: false,
      };

      const result = await assistant.run(
        "美化并重新组织这篇文档。要求：1) 顶部加摘要 Callout；2) 长段落拆分；3) 重要内容用 Callout 卡片；4) 适当加 Mermaid 图；5) 概念加双链；6) 保持原有信息完整不丢失。",
        ctx
      );
      notice.hide();

      new AssistantResultModal(
        this.app,
        { ...result, mode: "replace", explanation: "美化文档（将替换全文）" },
        () => { editor.setValue(result.content); new Notice("✅ 文档已美化"); },
        () => { void this.beautifyCurrentNote(); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 美化失败：${(err as Error).message}`);
    }
  }

  /** 获取已知概念列表（用于自动双链） */
  private getKnownConcepts(): string[] {
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(conceptsPath))
      .map((f) => f.basename);
  }

  // ── 定时任务 ─────────────────────────────────────────────────

  private startScheduler(): void {
    const defaultTasks: ScheduledTaskConfig[] = [
      {
        id: "daily-debt-scan",
        name: "每日知识债务扫描",
        enabled: false, // user must opt-in via settings
        kind: "knowledge-debt-scan",
        trigger: { type: "daily", time: "22:00" },
        safety: "notify-only",
      },
      {
        id: "daily-baidu-backup",
        name: "每日百度备份",
        enabled: this.settings.baiduSync.enabled && this.settings.baiduSync.autoBackup,
        kind: "baidu-backup",
        trigger: { type: "daily", time: "23:00" },
        safety: "auto-execute-low-risk",
      },
    ];

    this.scheduler = new ScheduledTaskRunner(this, defaultTasks);
    this.scheduler.start();
  }

  // ── 设置 ───────────────────────────────────────────────────

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
    if (!silent) new Notice("✅ 已从百度云拉取配置");
  }
}
