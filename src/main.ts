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

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();
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
        () => { void this.runAssistant(instruction); }
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
        // 不修改文件，结果已在预览弹窗中展示
        break;
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

    const knownConcepts = this.getKnownConcepts();
    const beautifier = new MarkdownBeautifier(knownConcepts);
    const beautified = beautifier.beautify(content);

    if (beautified === content) {
      new Notice("✅ 文档已经很整洁，无需美化");
      return;
    }

    editor.setValue(beautified);
    new Notice("✅ 文档已美化");
  }

  /** 获取已知概念列表（用于自动双链） */
  private getKnownConcepts(): string[] {
    const conceptsPath = normalizePath(this.settings.conceptsPath || "Knowledge/Concepts");
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(conceptsPath))
      .map((f) => f.basename);
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
