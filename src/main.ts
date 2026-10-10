import { Notice, Plugin, TFile, normalizePath, Platform } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, CompletionDepth } from "./types";
import { DeepSeekSettingsTab } from "./settings/SettingsTab";
import { BaiduSyncService } from "./features/sync/BaiduSyncService";
import { BaiduSyncModal } from "./features/sync/BaiduSyncModal";
import { BaiduSyncView, SYNC_VIEW_TYPE } from "./features/sync/BaiduSyncView";
import { BaiduGitSyncModal } from "./features/sync/BaiduGitSyncModal";
import { BaiduGitSyncService } from "./features/sync/BaiduGitSyncService";
import { loadBaiduSyncConfig } from "./types";
import { AIAssistant, AssistantContext, AssistantResult } from "./ai/AIAssistant";
import { AssistantInputModal, AssistantResultModal } from "./features/assistant/AssistantModal";
import { ReadingPlanner } from "./ai/ReadingPlanner";
import { NewReadingModal } from "./features/reading/ReadingModal";
import { ReadingProjectManager } from "./features/reading/ReadingProjectManager";
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
import { ArtifactFeatureController } from "./features/artifact/ArtifactFeatureController";
import { SCHEMA_VERSION, todayIso } from "./core/schema";
import { KnowledgeIndexService } from "./core/knowledge";
import { LLMClient, parseJsonSafe } from "./core/llm";
import { frontmatterOf, fmString } from "./util/frontmatter";
import { WritingPlanner } from "./ai/WritingPlanner";
import { StoryContinuer } from "./ai/StoryContinuer";
import { WritingProjectManager } from "./features/writing/WritingProjectManager";
import { NewWritingModal, NewWritingInput } from "./features/writing/NewWritingModal";
import { ContinueModal } from "./features/writing/ContinueModal";
import { WritingPlanPreviewModal } from "./features/writing/WritingPlanPreviewModal";
import { ImportModal } from "./features/writing/import/ImportModal";
import { WritingGenre, WritingContext, WritingPlan, ContinueRequest, ChapterOutline } from "./features/writing/types";
import { registerQuickIcons } from "./ui/icons";
import { availableQuickActions, QuickActionId } from "./actions/quickActions";
import { captureEditorTarget, checkEditorTarget, writeEditorResult, EditorTarget } from "./editor/EditorTarget";
import { SmartCompleter } from "./ai/SmartCompleter";

export default class DeepSeekPlugin extends Plugin {
  settings!: DeepSeekSettings;
  /** In-memory vault knowledge index, rebuilt on load, updated incrementally. */
  knowledgeIndex!: KnowledgeIndexService;
  private automaticSyncRunning = false;
  private automaticSyncMessage = "";
  private aiJobs = new Set<string>();

  async onload() {
    await this.loadSettings();

    // Build knowledge index
    this.knowledgeIndex = new KnowledgeIndexService(this.app);
    this.app.workspace.onLayoutReady(() => {
      this.knowledgeIndex.rebuild();
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
    this.registerInterval(window.setInterval(() => { void this.runAutomaticGitSync(); }, 60_000));
    this.app.workspace.onLayoutReady(() => { void this.runAutomaticGitSync(); });
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
    registerQuickIcons();
    registerAllActions(this, ALL_ACTIONS);
    if (!Platform.isMobile) this.registerWritingStatusBar();
  }

  /** 状态栏快捷入口:打开章节文件时显示「续写」与「下一章」按钮 */
  private registerWritingStatusBar() {
    const item = this.addStatusBarItem();
    item.addClass("istart-writing-status");

    const update = () => {
      item.empty();
      const file = this.app.workspace.getActiveFile();
      const meta = file ? this.app.metadataCache.getFileCache(file) : null;
      if (fmString(frontmatterOf(meta), "type") !== "chapter") return;

      const continueBtn = item.createSpan({ cls: "istart-writing-status-btn", text: "续写" });
      continueBtn.setAttribute("aria-label", "续写当前章节");
      continueBtn.addEventListener("click", () => { void this.continueWriting(); });

      const nextBtn = item.createSpan({ cls: "istart-writing-status-btn", text: "下一章" });
      nextBtn.setAttribute("aria-label", "按大纲生成下一章");
      nextBtn.addEventListener("click", () => { void this.generateNextChapter(); });
    };

    this.registerEvent(this.app.workspace.on("active-leaf-change", update));
    this.registerEvent(this.app.metadataCache.on("changed", update));
    update();
  }

  // ── AI 助手（统一入口） ────────────────────────────────────

  openAssistant(target: EditorTarget | null = captureEditorTarget(this.app)) {
    const activeFile = target?.file ?? this.app.workspace.getActiveFile();
    const selection = target?.selection.trim() ?? "";
    const fileName = activeFile?.basename ?? "";

    // 构建上下文提示
    const hints: string[] = [];
    if (selection) hints.push(` 已选中 ${selection.length} 字`);
    if (fileName) hints.push(` ${fileName}`);
    const contextHint = hints.join("  |  ");

    new AssistantInputModal(this.app, contextHint, (instruction) => {
      if (instruction.trim() === "续写") { void this.continueWriting(false, target); }
      else { void this.runAssistant(instruction, target); }
    }, {
      quickActions: target ? availableQuickActions(!!selection) : [],
      onQuickAction: (id) => { void this.runQuickAction(id, target); },
    }).open();
  }

  private async runAssistant(instruction: string, target: EditorTarget | null, resultMode?: AssistantResult["mode"]) {
    const activeFile = target?.file ?? null;
    const selection = target?.selection.trim() ?? "";
    const fileContent = target?.content ?? "";
    const fileName = activeFile?.basename ?? "";
    const fileMeta = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const fileType = fmString(frontmatterOf(fileMeta), "type");

    // 计算光标上下文
    let cursorLineBefore = "";
    let sectionName: string | null = null;
    let sectionEmpty = false;

    if (target) {
      const cursor = target.cursor;
      cursorLineBefore = fileContent.slice(0, target.editor.posToOffset(cursor));

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

    await this.previewGenerated(target, "AI 思考中...", async () => {
      const knownConcepts = this.getKnownConcepts();
      const style = this.settings.outputStyle ?? "knowledge-base";
      const assistant = new AIAssistant(this.settings, style, knownConcepts);
      const result = await assistant.run(instruction, ctx);
      return resultMode ? { ...result, mode: resultMode } : result;
    }, () => { void this.runAssistant(instruction, target, resultMode); }, undefined, true);
  }

  private applyResult(result: AssistantResult, target: EditorTarget | null): EditorTarget | null {
    if (!target) { new Notice("无法写入：请先打开文档"); return null; }
    try {
      const nextTarget = writeEditorResult(this.app, target, result);
      new Notice(result.mode === "replace" ? "已替换" : "已插入");
      if (fmString(frontmatterOf(this.app.metadataCache.getFileCache(target.file)), "type") !== "chapter") {
        void this.ensureLinkedConcepts(result.content);
      }
      return nextTarget;
    } catch (error) {
      new Notice((error as Error).message);
      return null;
    }
  }

  private async previewGenerated(
    target: EditorTarget | null,
    message: string,
    generate: () => Promise<AssistantResult>,
    retry: () => void,
    continueAfter?: (target: EditorTarget) => void,
    allowConcept = false
  ) {
    const key = target?.path ?? "assistant";
    if (this.aiJobs.has(key)) { new Notice("当前文档正在生成，请稍候"); return; }
    this.aiJobs.add(key);
    const notice = new Notice(message, 0);
    try {
      if (target) checkEditorTarget(this.app, target);
      const result = await generate();
      if (!result.content.trim()) { new Notice("AI 未能生成有效内容，请重试"); return; }
      new AssistantResultModal(this.app, result,
        () => !!this.applyResult(result, target), retry,
        // Keep the existing concept-page action available for generic assistant output.
        allowConcept ? () => {
          if (target) checkEditorTarget(this.app, target);
          void this.createConceptFromContent(result.content, target?.selection ?? "");
        } : undefined,
        continueAfter ? {
          label: "插入并继续",
          callback: () => {
            const nextTarget = this.applyResult(result, target);
            if (!nextTarget) return false;
            continueAfter(nextTarget);
            return true;
          },
        } : undefined
      ).open();
    } catch (error) {
      new Notice(`生成失败：${(error as Error).message}`);
    } finally {
      notice.hide();
      this.aiJobs.delete(key);
    }
  }

  async runQuickAction(id: QuickActionId, target: EditorTarget | null = captureEditorTarget(this.app)) {
    if (!target) { new Notice("请先打开文档"); return; }
    if (id === "continue") { await this.continueWriting(false, target); return; }
    if (id === "polish") { await this.polishWriting(target); return; }
    if ((id === "expand" || id === "explain") && !target.selection.trim()) { new Notice("请先选中文字"); return; }
    if (id === "expand") {
      await this.previewGenerated(target, "扩写中...", async () => {
        const result = await new SmartCompleter(this.settings).expand(target.selection, target.content);
        return { mode: "replace", content: result.content, explanation: "扩写选中文字" };
      }, () => { void this.runQuickAction(id, target); });
      return;
    }
    await this.runAssistant(id === "explain" ? "解释选中的文字" : "总结这篇文档", target, "show");
  }

  /** 将 AI 生成的内容创建为新概念页 */
  private async createConceptFromContent(content: string, conceptName: string) {
    const name = conceptName.trim().replace(/\[\[|\]\]/g, "") || "新概念";
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    const uncategorizedPath = normalizePath(`${conceptsPath}/_未分类`);

    // 记录发起页面（必须在切换文件之前）
    const sourceFile = this.app.workspace.getActiveFile();
    const sourcePath = sourceFile?.path ?? "";

    // 1. 先在原文档中把选中词替换为 [[双链]](保护已有链接,不依赖 lookbehind)
    if (sourceFile && name) {
      const sourceContent = await this.app.vault.read(sourceFile);
      const escaped = this.escapeRegex(name);
      const linked = this.replaceOutsideLinks(
        sourceContent,
        new RegExp(escaped + "(?!\\]\\])", "g"),
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
      new Notice(` 已追加到概念页：${name}`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(existing);
    } else if (existing) {
      // 路径被非 markdown 文件占用，安全降级：换名
      const altPath = await this.findFreePath(uncategorizedPath, name);
      const today = todayIso();
      const fullContent = `---\ntype: concept\nschema_version: ${SCHEMA_VERSION}\nname: ${name}\nstatus: completed\ncreated_from: ai-assistant\nsource: "[[${sourcePath}]]"\ncreated_at: ${today}\n---\n\n# ${name}\n\n${content}${sourceLink}`;
      const file = await this.app.vault.create(altPath, fullContent);
      new Notice(` 已创建概念页：${file.basename}（原路径被占用，已自动换名）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } else {
      const today = todayIso();
      const fullContent = `---\ntype: concept\nschema_version: ${SCHEMA_VERSION}\nname: ${name}\nstatus: completed\ncreated_from: ai-assistant\nsource: "[[${sourcePath}]]"\ncreated_at: ${today}\n---\n\n# ${name}\n\n${content}${sourceLink}`;
      const file = await this.app.vault.create(filePath, fullContent);
      new Notice(` 已创建概念页：${name}（原文已建立链接）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }

    // 3. 创建内容中引用的其他概念页
    void this.ensureLinkedConcepts(content);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** 在非 [[链接]] 段内做替换(兼容 iOS 16.4 以下,不依赖 lookbehind) */
  private replaceOutsideLinks(text: string, regex: RegExp, replacement: string): string {
    const parts = text.split(/(\[\[[^\]]*\]\])/g);
    return parts
      .map((part, i) => (i % 2 === 1 ? part : part.replace(regex, replacement)))
      .join("");
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
      new Notice(` 已创建 ${created} 个新概念页`);
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
      const notice = new Notice(" 扫描空概念页...", 0);
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
    const notice = new Notice(` 正在补全"${conceptName}"...`, 0);
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
            new Notice(` 概念页"${conceptName}"补全完成`);
          })();
        },
        () => { void this.runConceptCompletion(file, conceptName, depth, context); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`补全失败：${(err as Error).message}`);
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

      const notice = new Notice(` (${done + 1}/${total}) 补全"${info.conceptName}"...`, 0);
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
        new Notice(`"${info.conceptName}"补全失败：${(err as Error).message}`);
      }
    }

    new Notice(` 批量补全完成：${done}/${total}`);
  }

  // ── 知识提问（带问题图谱） ─────────────────────────────────

  /** 提问入口：问题分类 → Q&A 生成 → 图谱更新 */
  openQuestionWithGraph() {
    new QuestionModal(this.app, (question) => {
      void this.askWithGraph(question);
    }).open();
  }

  private async askWithGraph(question: string) {
    const notice = new Notice(" AI 思考中...", 0);
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
      new Notice(`失败：${(err as Error).message}`);
    }
  }

  private async generateQAWithGraph(question: string, classification: import("./types").QuestionClassification) {
    const notice = new Notice(" 生成 Q&A 笔记...", 0);
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
      new Notice(` 已生成 Q&A：${question.slice(0, 30)}...`);

      // 打开生成的笔记
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (err) {
      notice.hide();
      new Notice(`失败：${(err as Error).message}`);
    }
  }

  // ── 执行资产 Builder ─────────────────────────────────────────

  /** 从当前知识生成执行资产（通用入口） */
  openArtifactBuilder() {
    new ArtifactFeatureController(this.app, this.settings, this.knowledgeIndex)
      .openBuilder();
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
      ? ` 已选中 ${selection.length} 字`
      : activeFile
      ? ` ${activeFile.basename}`
      : "";

    new AssistantInputModal(this.app, `[知识库问答] ${contextHint}`, (instruction) => {
      void this.runVaultQA(instruction, selection, activeFile);
    }, { showSuggestions: false }).open();
  }

  private async runVaultQA(question: string, selection: string, activeFile: TFile | null) {
    const notice = new Notice(" 检索知识库并生成回答...", 0);
    const currentEditor = this.app.workspace.activeEditor?.editor ?? null;
    try {
      // 1. Search index for relevant entries
      // 数据边界:知识库问答默认排除写作产物(章节/设定/角色卡),写作可单向引用知识库
      const results = this.knowledgeIndex.search(question, {
        limit: 8,
        contextFile: activeFile?.path,
        excludeTypes: ["chapter", "writing-project", "character", "setting", "outline", "snippet"],
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
        contextParts.push(`--- 来源：[[${entry.path}|${entry.title}]] (${entry.type ?? "note"}) ---\n${snippet}`);
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
        ? `\n\n---\n\n## 依据来源\n\n${sourceFiles.map((s) => `- [[${s.path}|${s.title}]]`).join("\n")}\n`
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
          new Notice(" 已插入");
        },
        () => { void this.runVaultQA(question, selection, activeFile); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`失败：${(err as Error).message}`);
    }
  }

  // ── 阅读项目 ───────────────────────────────────────────────

  openNewReadingProject() {
    new NewReadingModal(this.app, (bookInfo, toc) => {
      void this.createReadingProject(bookInfo, toc);
    }).open();
  }

  private async createReadingProject(bookInfo: string, toc?: string) {
    const notice = new Notice(" 生成全书骨架...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const plan = await planner.planSkeleton(bookInfo, toc);
      notice.setMessage(` 创建项目结构（${plan.chapters.length} 章）...`);
      const manager = new ReadingProjectManager(this.app, this.settings);
      const indexFile = await manager.createProject(plan, (c, t, ch) => {
        notice.setMessage(` 生成预设问题 (${c}/${t})：${ch}`);
      });
      notice.hide();
      new Notice(` 阅读项目已创建：${plan.bookTitle}（${plan.chapters.length} 章）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(indexFile);
    } catch (err) {
      notice.hide();
      new Notice(`创建失败：${(err as Error).message}`);
    }
  }

  // ── 写作 ─────────────────────────────────────────────────

  /** 新建写作项目(网文/论文/长文) */
  openNewWritingProject() {
    new NewWritingModal(this.app, (input) => {
      void this.createWritingProject(input);
    }).open();
  }

  /** 导入已有原稿(网文/论文),原稿不动 */
  openImportNovel() {
    new ImportModal(this.app, this.settings).open();
  }

  private async createWritingProject(input: NewWritingInput) {
    const notice = new Notice("正在生成作品规划...", 0);
    try {
      const planner = new WritingPlanner(this.settings);
      const plan = await planner.plan(input.genre, input.title, input.premise);
      notice.hide();

      if (plan.chapters.length === 0) {
        new Notice("AI 未能生成有效的大纲，请重试");
        return;
      }

      new WritingPlanPreviewModal(this.app, plan, input.genre, () => {
        void this.saveWritingProject(plan, input.genre);
      }, () => {
        void this.createWritingProject(input);
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`生成失败：${(err as Error).message}`);
    }
  }

  private async saveWritingProject(plan: WritingPlan, genre: WritingGenre) {
    const notice = new Notice("正在创建项目文件...", 0);
    try {
      const manager = new WritingProjectManager(this.app, this.settings);
      const indexFile = await manager.createProject(plan, genre);
      notice.hide();
      new Notice(`作品已创建：${plan.title}（${plan.chapters.length} 章）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(indexFile);
    } catch (err) {
      notice.hide();
      new Notice(`创建失败：${(err as Error).message}`);
    }
  }

  /** 续写:光标处或文末,自动带入大纲与设定 */
  async continueWriting(configure = false, target: EditorTarget | null = captureEditorTarget(this.app)) {
    if (!target) { new Notice("请先打开文档"); return; }
    const request: ContinueRequest = {
      mode: this.settings.continueMode ?? "cursor", instruction: "", targetWords: this.settings.continueTargetWords,
    };
    if (configure) {
      new ContinueModal(this.app, request.targetWords, target.file.basename, (configured) => {
        this.settings.continueTargetWords = configured.targetWords;
        this.settings.continueMode = configured.mode;
        void this.saveSettings().catch(() => new Notice("续写偏好保存失败"));
        void this.runContinue(target, configured);
      }, request.mode).open();
    } else {
      await this.runContinue(target, request);
    }
  }

  private async runContinue(target: EditorTarget, request: ContinueRequest) {
    await this.previewGenerated(target, "AI 续写中...", async () => {
      const preceding = (request.mode === "chapter" ? target.content :
        target.content.slice(0, target.editor.posToOffset(target.cursor))).slice(-this.settings.continueContextChars);
      const fileType = fmString(frontmatterOf(this.app.metadataCache.getFileCache(target.file)), "type");
      let text: string;
      if (fileType === "chapter") {
        const ctx = await new WritingProjectManager(this.app, this.settings).loadContext(target.file);
        if (!ctx) throw new Error("无法读取章节的大纲与设定");
        text = await new StoryContinuer(this.settings).continueStory(ctx, request, preceding);
      } else {
        text = await new LLMClient(this.settings).chat({
          systemPrompt: `你是笔记续写助手。自然承接上文，保持语言、风格和格式一致，不重复已有内容。只输出续写正文，约 ${request.targetWords} 字。`,
          userPrompt: `上文：\n${preceding}\n\n${request.instruction || "自然接着写下去"}`,
          temperature: 0.6,
        });
      }
      return { mode: request.mode === "cursor" ? "insert" : "append", content: text, explanation: `续写：${target.file.basename}` };
    }, () => { void this.runContinue(target, request); },
    (nextTarget) => { void this.runContinue(nextTarget, request); });
  }

  /** 按大纲生成下一章 */
  async generateNextChapter(activeFile: TFile | null = this.app.workspace.getActiveFile()) {
    if (!activeFile) { new Notice("请先打开章节文件"); return; }
    const path = activeFile.path;
    if (this.aiJobs.has(path)) { new Notice("当前文档正在生成，请稍候"); return; }
    this.aiJobs.add(path);
    const target = captureEditorTarget(this.app);
    const notice = new Notice("正在准备下一章...", 0);
    try {
      const manager = new WritingProjectManager(this.app, this.settings);
      const ctx = await manager.loadContext(activeFile);
      if (!ctx) throw new Error("当前文件不是写作章节（需要 type: chapter）");
      const folder = activeFile.parent?.path ?? "";
      const outlineFile = this.app.vault.getAbstractFileByPath(normalizePath(`${folder}/_大纲.md`));
      if (!(outlineFile instanceof TFile)) throw new Error("未找到大纲文件");
      const next = manager.getNextChapter(await this.app.vault.read(outlineFile), ctx.chapterNumber);
      if (!next) { new Notice("大纲中已是最后一章"); return; }
      notice.setMessage(`正在生成第${next.number}章...`);
      const continuer = new StoryContinuer(this.settings);
      const text = await continuer.generateChapter(ctx, next, this.settings.continueTargetWords * 3);
      notice.hide();

      if (!text.trim()) { new Notice("AI 未能生成章节内容"); return; }

      new AssistantResultModal(
        this.app,
        { mode: "show", content: text, explanation: `新章节：第${next.number}章 ${next.title}` },
        async () => {
          if (target?.path === path) checkEditorTarget(this.app, target);
          await this.saveNextChapter(manager, folder, ctx, next, text);
        },
        () => { void this.generateNextChapter(activeFile); },
        undefined, undefined,
        { primaryLabel: "创建下一章", modeHint: "将按大纲创建新章节" }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`生成失败：${(err as Error).message}`);
    } finally {
      notice.hide();
      this.aiJobs.delete(path);
    }
  }

  private async saveNextChapter(
    manager: WritingProjectManager,
    folder: string,
    ctx: WritingContext,
    next: ChapterOutline,
    text: string
  ) {
    const file = await manager.createChapterNoteFromOutline(folder, ctx.projectTitle, ctx.genre, next);
    await manager.appendChapterText(file, text);
    await manager.markCurrentChapter(file, ctx.projectTitle);
    new Notice(`已创建第${next.number}章`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  /** 润色选中文字(保持作品文风) */
  async polishWriting(target: EditorTarget | null = captureEditorTarget(this.app)) {
    const selection = target?.selection.trim() ?? "";
    if (!target || !selection) { new Notice("请先选中要润色的文字"); return; }

    await this.previewGenerated(target, "润色中...", async () => {
      const ctx = await new WritingProjectManager(this.app, this.settings).loadContext(target.file);
      const llm = new LLMClient(this.settings);
      const systemPrompt = `你是专业的文字润色助手。在不改变原意的前提下，提升文字的流畅度与表现力，修正语病。直接输出润色后的文字，不要任何解释。`;
      const userPrompt = `${ctx?.styleProfile ? `文风基调：${ctx.styleProfile}\n\n` : ""}原文：\n${selection}\n\n润色后：`;
      const raw = await llm.chat({ systemPrompt, userPrompt, temperature: 0.6 });
      return { mode: "replace", content: raw.trim(), explanation: "润色（将替换选中文字）" };
    }, () => { void this.polishWriting(target); });
  }

  /** 从当前章节提取角色卡 */
  async extractCharacters() {
    const activeFile = this.app.workspace.getActiveFile();
    const editor = this.app.workspace.activeEditor?.editor ?? null;
    if (!activeFile) { new Notice("请先打开章节文件"); return; }

    const manager = new WritingProjectManager(this.app, this.settings);
    const ctx = await manager.loadContext(activeFile);
    if (!ctx) { new Notice("当前文件不是写作章节"); return; }
    if (ctx.genre !== "novel") { new Notice("仅网文小说支持角色卡提取"); return; }

    const content = editor?.getValue() ?? await this.app.vault.read(activeFile);
    if (!content.trim()) { new Notice("章节内容为空"); return; }

    const notice = new Notice("提取角色中...", 0);
    try {
      const llm = new LLMClient(this.settings);
      const systemPrompt = `你是角色卡提取助手。从小说章节中提取出场角色，输出 JSON：
{"characters": [{"name": "角色名", "role": "protagonist | support | villain", "summary": "外貌、性格、动机、能力，2-3 句"}]}
最多 5 个主要角色，只输出 JSON，不要其他内容。`;
      const raw = await llm.chat({
        systemPrompt,
        userPrompt: `章节：第${ctx.chapterNumber}章 ${ctx.chapterTitle}\n\n正文：\n${content.slice(0, 6000)}`,
        temperature: 0.4,
      });
      notice.hide();

      const parsed = parseJsonSafe<{ characters?: { name: string; role: string; summary: string }[] } | null>(raw, null);
      const characters = (parsed?.characters ?? []).filter((c) => c.name && c.summary);
      if (characters.length === 0) { new Notice("未识别到角色"); return; }

      let created = 0;
      for (const c of characters) {
        await manager.writeCharacter(activeFile, c);
        created++;
      }
      new Notice(`已提取 ${created} 个角色到 _角色/`);
    } catch (err) {
      notice.hide();
      new Notice(`提取失败：${(err as Error).message}`);
    }
  }

  // ── 百度云同步 ─────────────────────────────────────────────

  openBaiduSyncModal() {
    if (!this.settings.baiduSync.enabled) { new Notice("请先在设置中启用百度云同步"); return; }
    if (this.settings.baiduSync.syncEngine === "git") {
      new BaiduGitSyncModal(this.app, this.settings.baiduSync, () => this.saveSettings()).open();
      return;
    }
    new BaiduSyncModal(this.app, this.settings.baiduSync, async (accessToken, expiresAt) => {
      this.settings.baiduSync.accessToken = accessToken;
      this.settings.baiduSync.tokenExpiresAt = expiresAt;
      await this.saveSettings();
    }).open();
  }

  private async runAutomaticGitSync() {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || cfg.syncEngine !== "git" || !cfg.autoSync || !cfg.accessToken
      || document.visibilityState !== "visible" || this.automaticSyncRunning) return;
    this.automaticSyncRunning = true;
    try {
      const result = await new BaiduGitSyncService(this.app, cfg).sync();
      await this.saveSettings();
      const message = result.conflicts.length ? "Git 同步存在冲突，请打开同步窗口处理" : "";
      if (message && message !== this.automaticSyncMessage) new Notice(message);
      this.automaticSyncMessage = message;
    } catch (error) {
      const message = (error as Error).message;
      if (message !== this.automaticSyncMessage) new Notice(`自动 Git 同步：${message}`);
      this.automaticSyncMessage = message;
    } finally { this.automaticSyncRunning = false; }
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

    const notice = new Notice(" AI 正在重新组织文档结构...", 0);
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
        () => { editor.setValue(result.content); new Notice(" 文档已美化"); },
        () => { void this.beautifyCurrentNote(); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`美化失败：${(err as Error).message}`);
    }
  }

  /** 获取已知概念列表（用于自动双链） */
  private getKnownConcepts(): string[] {
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(conceptsPath))
      .map((f) => f.basename);
  }

  // ── 执行模块入口已移除(v3.0)——原 ExecutionPlan 管线失效,详见 docs/design-writing-scenario.md

  // ── 设置 ───────────────────────────────────────────────────

  async loadSettings() {
    const saved: Partial<DeepSeekSettings> | null = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings.baiduSync = loadBaiduSyncConfig(saved?.baiduSync);
    if (this.settings.baiduSync.enabled && this.settings.baiduSync.accessToken && this.settings.baiduSync.autoPullConfig) {
      void this.pullConfig(true);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof BaiduSyncView) leaf.view.refreshSettings();
    }
  }

  async pushConfig() {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) { new Notice("请先启用百度云同步并完成授权"); return; }
    const service = new BaiduSyncService(this.app, cfg);
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const ok = await service.pushConfig(this.settings, adapter.basePath ?? "unknown-device");
    new Notice(ok ? "配置已推送到百度云" : "配置推送失败");
  }

  async pullConfig(silent = false) {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) return;
    const service = new BaiduSyncService(this.app, cfg);
    const remote = await service.pullConfig(undefined);
    if (!remote) { if (!silent) new Notice("远端无配置或已是最新"); return; }
    this.settings = BaiduSyncService.applyRemoteConfig(this.settings, remote);
    await this.saveSettings();
    if (!silent) new Notice(" 已从百度云拉取配置");
  }
}
