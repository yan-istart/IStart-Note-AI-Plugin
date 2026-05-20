import { App, TFile, Notice, normalizePath } from "obsidian";
import { DeepSeekSettings } from "../../types";
import { LLMClient, parseJsonSafe } from "../../core/llm";
import { KnowledgeIndexService } from "../../core/knowledge";
import { todayIso } from "../../core/schema";
import {
  ArtifactBuildParams, ArtifactPromptBuilder, ArtifactRenderer,
  ArtifactValidator, ExecutionArtifact, ArtifactSourceScope,
} from "../../core/artifact";
import { ArtifactBuilderModal } from "./ArtifactBuilderModal";
import { ArtifactPreviewModal, ArtifactSaveChoice } from "./ArtifactPreviewModal";

/**
 * Orchestrates the Execution Artifact Builder flow:
 *   context detection → builder modal → LLM → validate → preview → save
 */
export class ArtifactFeatureController {
  constructor(
    private app: App,
    private settings: DeepSeekSettings,
    private knowledgeIndex: KnowledgeIndexService
  ) {}

  /** Entry point: detect context and open builder. */
  openBuilder(): void {
    this.openBuilderWithPreset({});
  }

  /** Open builder with a preset (e.g. artifactType pre-selected). */
  openBuilderWithPreset(preset: { artifactType?: string }): void {
    const editor = this.app.workspace.activeEditor?.editor ?? null;
    const activeFile = this.app.workspace.getActiveFile();
    const selection = editor?.getSelection().trim() ?? "";

    let defaultScope: ArtifactSourceScope = "current-note";
    let contextHint = "";

    if (selection) {
      defaultScope = "selection";
      contextHint = `已选中 ${selection.length} 字`;
    } else if (activeFile?.path.includes("Reading/")) {
      defaultScope = "reading-project";
      const projectName = activeFile.path.split("/").filter(Boolean).find((_, i, arr) =>
        i > 0 && arr[i - 1] === "Reading"
      ) ?? "";
      contextHint = projectName ? `检测到阅读项目：${projectName}` : `当前在 Reading 目录`;
    } else if (activeFile) {
      contextHint = `当前笔记：${activeFile.basename}`;
    }

    new ArtifactBuilderModal(this.app, contextHint, defaultScope, (params) => {
      void this.generate(params, selection, activeFile);
    }, preset.artifactType as ArtifactSourceScope | undefined).open();
  }

  // ── Generation ─────────────────────────────────────────────

  private async generate(
    params: ArtifactBuildParams,
    selection: string,
    activeFile: TFile | null
  ): Promise<void> {
    const notice = new Notice("⏳ 正在生成执行资产...", 0);
    try {
      const context = await this.gatherContext(params, selection, activeFile);

      const promptBuilder = new ArtifactPromptBuilder();
      const systemPrompt = promptBuilder.buildSystemPrompt();
      const userPrompt = promptBuilder.buildUserPrompt(params, context);

      const llm = new LLMClient(this.settings);
      const raw = await llm.chat({ systemPrompt, userPrompt, temperature: 0.4 });

      const parsed = parseJsonSafe<Partial<ExecutionArtifact> | null>(raw, null);
      if (!parsed) {
        notice.hide();
        new Notice("AI 未能生成有效的执行资产结构");
        return;
      }

      const validator = new ArtifactValidator();
      const artifact = validator.normalize({
        ...parsed,
        sourceScope: params.sourceScope,
        evidencePolicy: params.evidencePolicy,
        usageMode: params.usageMode,
      });

      notice.hide();
      this.showPreview(artifact, params, selection, activeFile);
    } catch (err) {
      notice.hide();
      new Notice(`❌ ${(err as Error).message}`);
    }
  }

  // ── Preview ────────────────────────────────────────────────

  private showPreview(
    artifact: ExecutionArtifact,
    params: ArtifactBuildParams,
    selection: string,
    activeFile: TFile | null
  ): void {
    new ArtifactPreviewModal(this.app, artifact, (choice: ArtifactSaveChoice) => {
      switch (choice) {
        case "save-template":
          void this.saveTemplate(artifact);
          break;
        case "save-and-run":
          void this.saveTemplateAndRun(artifact);
          break;
        case "regenerate":
          void this.generate(params, selection, activeFile);
          break;
      }
    }).open();
  }

  // ── Save ───────────────────────────────────────────────────

  private async saveTemplate(artifact: ExecutionArtifact): Promise<TFile> {
    const folder = normalizePath("Knowledge/Artifacts");
    await this.ensureFolder(folder);

    const renderer = new ArtifactRenderer();
    const content = renderer.renderTemplate(artifact);
    const path = await this.uniquePath(folder, artifact.title);
    const file = await this.app.vault.create(path, content);

    new Notice(`✅ 模板已保存：${artifact.title}`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    return file;
  }

  private async saveTemplateAndRun(artifact: ExecutionArtifact): Promise<void> {
    await this.saveTemplate(artifact);

    const runFolder = normalizePath("Knowledge/Artifact Runs");
    await this.ensureFolder(runFolder);

    const renderer = new ArtifactRenderer();
    const today = todayIso();
    const runContent = renderer.renderRun(artifact, today);
    const runPath = await this.uniquePath(runFolder, `${today} ${artifact.title}`);
    const runFile = await this.app.vault.create(runPath, runContent);

    new Notice(`✅ 今日执行记录已创建`);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(runFile);
  }

  // ── Context gathering ──────────────────────────────────────

  private async gatherContext(
    params: ArtifactBuildParams,
    selection: string,
    activeFile: TFile | null
  ): Promise<string> {
    switch (params.sourceScope) {
      case "selection":
        return selection || "(无选中内容)";

      case "current-note": {
        if (!activeFile) return "(无当前笔记)";
        const content = await this.app.vault.cachedRead(activeFile);
        return content.slice(0, 3000);
      }

      case "reading-project": {
        if (!activeFile) return "(无当前文件)";
        const folder = activeFile.path.split("/").slice(0, -1).join("/");
        const siblings = this.app.vault.getMarkdownFiles()
          .filter((f) => f.path === folder || f.path.startsWith(folder + "/"))
          .sort((a, b) => a.path.localeCompare(b.path))
          .slice(0, 10);

        const parts: string[] = [];
        for (const f of siblings) {
          const content = await this.app.vault.cachedRead(f);
          parts.push(`--- [[${f.path}|${f.basename}]] ---\n${content.slice(0, 500)}`);
        }
        return parts.join("\n\n") || "(阅读项目无内容)";
      }

      case "related-vault": {
        // Use params.target + artifactType + basename for richer query
        const queryParts = [params.target, params.artifactType, activeFile?.basename].filter(Boolean);
        const query = queryParts.join(" ");
        const results = this.knowledgeIndex.search(query, { limit: 6 });
        const parts: string[] = [];
        for (const { entry } of results) {
          const file = this.app.vault.getAbstractFileByPath(entry.path);
          if (!file || !(file instanceof TFile)) continue;
          const content = await this.app.vault.cachedRead(file);
          parts.push(`--- [[${entry.path}|${entry.title}]] ---\n${content.slice(0, 500)}`);
        }
        return parts.join("\n\n") || "(未找到相关知识)";
      }

      case "freeform":
        return "(自由生成模式，无固定来源)";
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private async ensureFolder(path: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(path)) {
      await this.app.vault.createFolder(path);
    }
  }

  private async uniquePath(folder: string, title: string): Promise<string> {
    const safeName = title.replace(/[\\/:*?"<>|#[\]]/g, "-").slice(0, 50);
    let path = normalizePath(`${folder}/${safeName}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${safeName}-${suffix}.md`);
      suffix++;
    }
    return path;
  }
}
