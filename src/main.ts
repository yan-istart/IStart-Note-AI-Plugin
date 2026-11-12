import { ImportAgentBridge } from "./features/writing/import/ImportAgentBridge";
import { Notice, Plugin, TAbstractFile, TFile, Platform, MarkdownView } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, loadSkillSettings, loadFloatingToolbarSettings } from "./types";
import { DeepSeekSettingsTab } from "./settings/SettingsTab";
import { BaiduSyncService } from "./features/sync/BaiduSyncService";
import { BaiduSyncModal } from "./features/sync/BaiduSyncModal";
import { BaiduSyncView, SYNC_VIEW_TYPE } from "./features/sync/BaiduSyncView";
import { BaiduGitSyncModal } from "./features/sync/BaiduGitSyncModal";
import { BaiduGitSyncService } from "./features/sync/BaiduGitSyncService";
import { GitChangesController } from "./features/sync/GitChangesController";
import { loadBaiduSyncConfig } from "./types";
import { registerAllActions } from "./actions/registry";
import { ALL_ACTIONS } from "./actions/definitions";
import { KnowledgeIndexService } from "./core/knowledge";
import { frontmatterOf, fmString } from "./util/frontmatter";
import { ImportModal } from "./features/writing/import/ImportModal";
import { registerQuickIcons } from "./ui/icons";
import { QuickActionId } from "./actions/quickActions";
import { captureEditorTarget, EditorTarget } from "./editor/EditorTarget";
import { AnnotationView, ANNOTATION_VIEW_TYPE } from "./features/annotation/AnnotationView";
import { AnnotationModal } from "./features/annotation/AnnotationModal";
import { AnnotationService, inspectAnnotationSelection } from "./features/annotation/AnnotationService";
import { headingAtOffset } from "./core/annotations/AnnotationParser";
import type { AnnotationCommentStyle } from "./core/annotations/AnnotationParser";
import { SkillRegistry } from "./core/skills/SkillRegistry";
import { setSkillProvider } from "./core/skills/SkillRuntime";
import { selectSkills } from "./core/skills/SkillSelector";
import { resolveWritingScope } from "./core/skills/WritingScope";
import { createEditorAnchorExtension } from "./features/agent/EditorAnchorExtension";
import { createFloatingToolbarExtension } from "./features/toolbar/FloatingToolbarExtension";
import { AgentController, SYNC_HISTORY_PATH } from "./features/agent/AgentController";
import { AgentView, AGENT_VIEW_TYPE } from "./features/agent/AgentView";
import { referenceFromTarget } from "./core/agent/Context";
import { loadAgentSettings, type NoteReference } from "./core/agent/types";
import { setResultConversationHandler } from "./features/agent/ResultConversation";
import { TypoCheckView, TYPO_CHECK_VIEW_TYPE } from "./features/proofreading/TypoCheckView";
import { WorkbenchController, WorkbenchSection } from "./features/workbench/WorkbenchController";
import { AGENT_TASKS, createAgentTask } from "./core/agent/AgentTasks";

export default class DeepSeekPlugin extends Plugin {
  settings!: DeepSeekSettings;
  /** In-memory vault knowledge index, rebuilt on load, updated incrementally. */
  knowledgeIndex!: KnowledgeIndexService;
  /** Local Agent Skills discovered from Skills/ and .agents/skills. */
  skillRegistry!: SkillRegistry;
  agent!: AgentController;
  private workbench?: WorkbenchController;
  private automaticSyncRunning = false;
  gitChanges!: GitChangesController;
  private automaticSyncMessage = "";

  async onload() {
    await this.loadSettings();

    this.skillRegistry = new SkillRegistry(this.app, () => this.settings.skills);
    void this.skillRegistry.refresh();
    this.registerSkillRuntime();

    this.agent = new AgentController(this);
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdown) this.agent.trackView(activeMarkdown);
    await this.agent.load();
    this.registerView(AGENT_VIEW_TYPE, leaf => new AgentView(leaf, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (leaf?.view instanceof MarkdownView) this.agent.trackView(leaf.view);
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file.path === SYNC_HISTORY_PATH) void this.agent.pullSharedHistory().catch(error => new Notice(`会话共享读取失败：${(error as Error).message}`));
    }));
    setResultConversationHandler((content, reference) => {
      this.agent.importResult(content, reference);
      void this.activateAgentView();
    });
    this.addCommand({ id: "open-workbench", name: "打开 IStart 工作台", callback: () => this.openAssistant() });
    this.addCommand({ id: "agent-new-session", name: "新建 AI 会话", callback: () => { void this.activateAgentView(undefined, true); } });
    this.addCommand({ id: "agent-stop", name: "停止当前 AI 会话生成", callback: () => { const s = this.agent.active; if (s) this.agent.stop(s.id); } });
    this.addCommand({ id: "ai-assistant-quick", name: "打开 AI 助手（兼容快捷命令）", callback: () => this.openQuickAssistant() });
    this.addCommand({ id: "vault-qa-quick", name: "打开知识库问答（兼容快捷命令）", callback: () => this.openVaultQAQuick() });

    // Build knowledge index
    this.knowledgeIndex = new KnowledgeIndexService(this.app, (path) => this.skillRegistry.isSkillPath(path));
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
    const invalidateSkills = (file: TAbstractFile) => {
      if (this.skillRegistry.isSkillPath(file.path)) this.skillRegistry.invalidate();
    };
    this.registerEvent(this.app.vault.on("modify", invalidateSkills));
    this.registerEvent(this.app.vault.on("create", invalidateSkills));
    this.registerEvent(this.app.vault.on("delete", invalidateSkills));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.skillRegistry.isSkillPath(oldPath)) this.skillRegistry.invalidate();
      invalidateSkills(file);
    }));

    this.gitChanges = new GitChangesController(this);
    this.addChild(this.gitChanges);
    this.registerView(SYNC_VIEW_TYPE, (leaf) => new BaiduSyncView(leaf, this));
    this.registerView(ANNOTATION_VIEW_TYPE, (leaf) => new AnnotationView(leaf, this));
    this.registerView(TYPO_CHECK_VIEW_TYPE, (leaf) => new TypoCheckView(leaf, this));
    this.app.workspace.onLayoutReady(() => {
      void this.workbenchController.consolidate().catch(error => new Notice(`工作台恢复失败：${(error as Error).message}`));
    });
    this.registerInterval(window.setInterval(() => { void this.runAutomaticGitSync(); }, 60_000));
    this.app.workspace.onLayoutReady(() => { void this.runAutomaticGitSync(); });
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
    registerQuickIcons();
    registerAllActions(this, ALL_ACTIONS);
    this.registerEditorExtension(createFloatingToolbarExtension(this));
    this.registerEditorExtension(createEditorAnchorExtension(this.agent));
    if (!Platform.isMobile) this.registerWritingStatusBar();
  }

  /** Install one skill provider shared by every LLMClient call. */
  private registerSkillRuntime(): void {
    setSkillProvider(async (request) => {
      if (!this.settings.skills.enabled) return [];
      const activeFile = request.useActiveFile === false ? null : this.app.workspace.getActiveFile();
      const inferred = activeFile ? await resolveWritingScope(this.app, activeFile) : null;
      const writingScope = request.projectPath
        ? {
            projectTitle: request.projectTitle ?? inferred?.projectTitle ?? "",
            projectPath: request.projectPath,
            genre: request.genre ?? inferred?.genre ?? "",
          }
        : inferred;
      const genre = request.genre ?? writingScope?.genre ?? "";
      const skills = await this.skillRegistry.ensureLoaded();
      return selectSkills(
        skills,
        { ...request, writingScope, genre },
        this.settings.skills
      );
    });
  }

  onunload(): void {
    setSkillProvider(null);
    setResultConversationHandler(null);
    void this.agent?.dispose().catch(error => new Notice(`会话保存失败：${(error as Error).message}`));
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
      continueBtn.addEventListener("click", () => { void this.startAgentAction("continue-writing"); });

      const nextBtn = item.createSpan({ cls: "istart-writing-status-btn", text: "下一章" });
      nextBtn.setAttribute("aria-label", "按大纲生成下一章");
      nextBtn.addEventListener("click", () => { void this.startAgentAction("generate-next-chapter"); });
    };

    this.registerEvent(this.app.workspace.on("active-leaf-change", update));
    this.registerEvent(this.app.metadataCache.on("changed", update));
    update();
  }

  // ── AI 助手（统一入口） ────────────────────────────────────

  openAssistant(target: EditorTarget | null = captureEditorTarget(this.app), file?: TFile | null) {
    const reference = file ? { path: file.path } : target ? referenceFromTarget(target) : this.agent.captureCurrent();
    void this.activateAgentView(reference ?? undefined).catch(error => new Notice((error as Error).message));
  }

  async startAgentAction(actionId: string, target: EditorTarget | null = captureEditorTarget(this.app), file?: TFile | null): Promise<void> {
    try {
      if (!this.settings.apiKey && !["knowledge-debt", "scan-empty-concepts"].includes(actionId)) throw new Error("请先在插件设置中配置 API Key");
      const def = AGENT_TASKS[actionId];
      if (!def) throw new Error("不支持的助手任务");
      const reference = def.context === "none" ? null : file && file.path !== target?.path ? { path: file.path }
        : target ? referenceFromTarget(target) : this.agent.captureTaskReference();
      await this.startAgentTask(actionId, reference ?? undefined);
    } catch (error) { new Notice(`无法执行助手任务：${error instanceof Error ? error.message : String(error)}`); }
  }

  async startAgentTask(actionId: string, reference?: NoteReference, args: Record<string, string | number | boolean> = {}): Promise<void> {
    const def = AGENT_TASKS[actionId];
    const task = createAgentTask(actionId, this.settings, reference);
    Object.assign(task.args, args);
    const session = this.agent.prepareTask(task, reference ? [reference] : []);
    await this.activateWorkbench("assistant");
    if (!def.configure) await this.agent.submitTask(session.id);
  }

  async activateAgentView(reference?: NoteReference, fresh = false): Promise<void> {
    if (this.agent.error) new Notice(this.agent.error);
    else if (fresh || !this.agent.active || this.agent.active.archived || (reference && this.agent.active.messages.length > 0 && (this.agent.isRunning(this.agent.active.id) || this.agent.active.references[0]?.path !== reference.path))) this.agent.create(reference ? [reference] : []);
    else if (reference) this.agent.attach(reference);
    await this.activateWorkbench("assistant");
  }

  private get workbenchController(): WorkbenchController {
    return this.workbench ?? (this.workbench = new WorkbenchController(this.app.workspace));
  }

  private activateWorkbench(section: WorkbenchSection) {
    return this.workbenchController.activate(section);
  }

  /** Compatibility entry points retain saved commands and hotkeys. */
  openQuickAssistant(target: EditorTarget | null = captureEditorTarget(this.app)) { this.openAssistant(target); }

  async runQuickAction(id: QuickActionId, target: EditorTarget | null = captureEditorTarget(this.app)) {
    const actions: Record<QuickActionId, string> = { continue: "continue-writing", insert: "insert-writing", "continue-settings": "continue-writing-settings", "insert-settings": "insert-writing-settings", polish: "polish-writing", expand: "expand-selection", explain: "explain-selection", summarize: "summarize-note" };
    await this.startAgentAction(actions[id], target);
  }

  async checkCurrentNoteTypos(target: EditorTarget | null = captureEditorTarget(this.app)): Promise<void> {
    await this.startAgentAction("check-typos", target);
  }

  async showProofreading(report: import("./core/agent/types").ProofreadingReport): Promise<void> {
    const workspace = this.app.workspace;
    let leaf = workspace.getLeavesOfType(TYPO_CHECK_VIEW_TYPE)[0];
    if (!leaf) leaf = await workspace.ensureSideLeaf(TYPO_CHECK_VIEW_TYPE, "right", { active: true, reveal: true, split: false });
    if (!(leaf.view instanceof TypoCheckView)) await leaf.setViewState({ type: TYPO_CHECK_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    if (leaf.view instanceof TypoCheckView) await leaf.view.showResult(report);
  }

  // ── 侧边栏批注 ─────────────────────────────────────────────

  async activateAnnotationView() {
    const leaf = await this.activateWorkbench("annotations");
    if (leaf.view instanceof AnnotationView) leaf.view.refresh();
  }

  /** 为选中文字添加高亮与批注；AI 批注会先草拟一段可编辑的批注。 */
  addAnnotation(aiDraft = false, target: EditorTarget | null = captureEditorTarget(this.app)) {
    if (!target) {
      new Notice("请先打开文档并切换到编辑模式");
      return;
    }
    if (!target.selection.trim()) {
      new Notice("请先选中要批注的文字");
      return;
    }

    const fromOffset = target.editor.posToOffset(target.from);
    const toOffset = target.editor.posToOffset(target.to);
    const inspection = inspectAnnotationSelection(target.content, fromOffset, toOffset);
    if (inspection.error) {
      new Notice(inspection.error);
      return;
    }
    if (aiDraft) { void this.startAgentAction("ai-annotation", target); return; }
    const heading = headingAtOffset(target.content, fromOffset);

    new AnnotationModal(this.app, {
      selection: inspection.selected,
      fileName: target.file.basename,
      heading,
      defaultStyle: this.settings.annotationCommentStyle,
      autoDraft: aiDraft,
      onAgentDraft: (comment) => this.startAgentTask("ai-annotation", referenceFromTarget(target), { comment }),
      onSubmit: (comment: string, style: AnnotationCommentStyle) => {
        new AnnotationService(this.app).add({ target, comment, style });
        this.settings.annotationCommentStyle = style;
        void this.saveSettings().catch(() => new Notice("批注偏好保存失败"));
        this.refreshAnnotationViews();
      },
    }).open();
  }

  refreshAnnotationViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(ANNOTATION_VIEW_TYPE)) {
      if (leaf.view instanceof AnnotationView) leaf.view.refresh();
    }
  }

  openCompleteCurrentConcept() { void this.startAgentAction("complete-current-concept"); }
  openScanEmptyConcepts() { void this.startAgentAction("scan-empty-concepts"); }
  openQuestionWithGraph() { void this.startAgentAction("question-with-graph"); }
  openArtifactBuilder() { void this.startAgentAction("create-artifact"); }
  openKnowledgeDebt() { void this.startAgentAction("knowledge-debt"); }
  openNewReadingProject() { void this.startAgentAction("new-reading-project"); }
  openNewWritingProject() { void this.startAgentAction("new-writing-project"); }
  openImportNovel() { new ImportModal(this.app, this.settings, new ImportAgentBridge(this.agent, this.settings)).open(); }
  openVaultQAQuick() { this.openVaultQA(); }
  openVaultQA() {
    const target = captureEditorTarget(this.app);
    const reference = target ? referenceFromTarget(target) : this.agent.captureCurrent();
    void this.activateAgentView(reference ?? undefined).then(() => {
      const session = this.agent.active;
      if (session) this.agent.update(session.id, { mode: "ask", searchVault: true });
    }).catch(error => new Notice((error as Error).message));
  }


  async continueWriting(configure = false, target: EditorTarget | null = captureEditorTarget(this.app)) { await this.startAgentAction(configure ? "continue-writing-settings" : "continue-writing", target); }
  async insertWriting(configure = false, target: EditorTarget | null = captureEditorTarget(this.app)) { await this.startAgentAction(configure ? "insert-writing-settings" : "insert-writing", target); }
  async polishWriting(target: EditorTarget | null = captureEditorTarget(this.app)) { await this.startAgentAction("polish-writing", target); }
  async generateNextChapter(file: TFile | null = this.app.workspace.getActiveFile()) { await this.startAgentAction("generate-next-chapter", undefined, file); }
  async extractCharacters() { await this.startAgentAction("extract-characters"); }

  // ── IStart 数据同步 ────────────────────────────────────────

  openDataSyncModal() {
    if (!this.settings.baiduSync.enabled) { new Notice("请先在设置 → 数据同步中启用 IStart 数据同步"); return; }
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

  async activateSyncView() {
    await this.activateWorkbench("sync");
  }

  async beautifyCurrentNote() { await this.startAgentAction("beautify-note"); }

  // ── 执行模块入口已移除(v3.0)——原 ExecutionPlan 管线失效,详见 docs/design-writing-scenario.md

  // ── 设置 ───────────────────────────────────────────────────

  async loadSettings() {
    const saved: Partial<DeepSeekSettings> | null = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings.skills = loadSkillSettings(saved?.skills);
    this.settings.floatingToolbar = loadFloatingToolbarSettings(saved?.floatingToolbar);
    this.settings.baiduSync = loadBaiduSyncConfig(saved?.baiduSync);
    this.settings.agent = loadAgentSettings(saved?.agent);
    if (this.settings.baiduSync.enabled && this.settings.baiduSync.accessToken && this.settings.baiduSync.autoPullConfig) {
      void this.pullConfig(true);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.gitChanges?.schedule();
    this.agent?.refreshSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof BaiduSyncView) leaf.view.refreshSettings();
    }
  }

  async pushConfig() {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) { new Notice("请先启用 IStart 数据同步，并在百度网盘配置中完成授权"); return; }
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
