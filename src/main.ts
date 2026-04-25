import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, CompletionDepth } from "./types";
import { DeepSeekClient } from "./DeepSeekClient";
import { VaultWriter } from "./VaultWriter";
import { QuestionModal } from "./QuestionModal";
import { DeepSeekSettingsTab } from "./SettingsTab";
import { ConceptCompleter } from "./ConceptCompleter";
import { ConceptPageManager } from "./ConceptPageManager";
import { DepthSelectModal, PreviewModal, BatchScanModal } from "./ConceptCompletionModal";
import { QuestionClassifier } from "./QuestionClassifier";
import { QuestionGraphManager } from "./QuestionGraphManager";
import { QuestionClassifyModal } from "./QuestionClassifyModal";
import { ContextQAClient } from "./ContextQAClient";
import { ContextQAModal } from "./ContextQAModal";

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();

    // 侧边栏图标
    this.addRibbonIcon("brain", "DeepSeek 提问", () => {
      this.openQuestionModal();
    });

    // 命令：提问
    this.addCommand({
      id: "ask-deepseek",
      name: "向 DeepSeek 提问并生成知识笔记",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }],
      callback: () => this.openQuestionModal(),
    });

    // 命令：补全当前概念页
    this.addCommand({
      id: "complete-current-concept",
      name: "补全当前概念页",
      callback: () => this.completeCurrentConcept(),
    });

    // 命令：扫描空概念页
    this.addCommand({
      id: "scan-empty-concepts",
      name: "扫描空概念页",
      callback: () => this.scanAndBatchComplete(),
    });

    // 命令：框选提问
    this.addCommand({
      id: "context-qa",
      name: "基于选中内容提问",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "q" }],
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("请先选中一段文字");
          return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        this.openContextQAModal(selection, activeFile?.path ?? "");
      },
    });

    // 命令：问题图谱索引
    this.addCommand({
      id: "open-question-index",
      name: "打开问题索引",
      callback: () => this.openQuestionIndex(),
    });

    // 设置页
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI：补全此概念页")
            .setIcon("brain")
            .onClick(async () => {
              const manager = new ConceptPageManager(this.app, this.settings);
              const info = await manager.analyzeFile(file);
              if (!info) {
                new Notice("该文件不是概念页");
                return;
              }
              new DepthSelectModal(this.app, info.conceptName, (depth) => {
                this.runConceptCompletion(info.file, info.conceptName, depth, {
                  sourceQuestion: info.sourceQuestion,
                  sourceAnswer: info.sourceAnswer,
                });
              }).open();
            });
        });
      })
    );

    // 编辑器内右键菜单
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection().trim();

        // 框选提问入口（有选中内容时显示）
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI：基于选中内容提问")
              .setIcon("message-circle")
              .onClick(() => {
                const activeFile = this.app.workspace.getActiveFile();
                this.openContextQAModal(selection, activeFile?.path ?? "");
              });
          });
        }

        // 概念补全入口
        const linkMatch = selection.match(/^\[\[(.+?)(?:\|.+?)?\]\]$/) ||
          selection.match(/^(.+)$/);
        const conceptName = linkMatch?.[1];
        if (!conceptName) return;

        menu.addItem((item) => {
          item
            .setTitle(`IStart-Note-AI：补全概念 "${conceptName}"`)
            .setIcon("brain")
            .onClick(async () => {
              const manager = new ConceptPageManager(this.app, this.settings);
              const conceptsPath = this.settings.conceptsPath || "Knowledge/Concepts";
              const filePath = `${conceptsPath}/${conceptName}.md`;
              let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;

              if (!file) {
                const writer = new VaultWriter(this.app, this.settings);
                await writer.ensureConceptNote(conceptName);
                file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
              }

              if (!file) {
                new Notice(`无法找到或创建概念页：${conceptName}`);
                return;
              }

              const info = await manager.analyzeFile(file);
              new DepthSelectModal(this.app, conceptName, (depth) => {
                this.runConceptCompletion(file!, conceptName, depth, {
                  sourceQuestion: info?.sourceQuestion,
                  sourceAnswer: info?.sourceAnswer,
                });
              }).open();
            });
        });

        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI：补全当前概念页")
            .setIcon("brain")
            .onClick(() => this.completeCurrentConcept());
        });
      })
    );
  }

  private openContextQAModal(selectedText: string, sourceNotePath: string) {
    new ContextQAModal(this.app, selectedText, (question) => {
      this.processContextQA(question, selectedText, sourceNotePath);
    }).open();
  }

  private async processContextQA(question: string, context: string, sourceNotePath: string) {
    const notice = new Notice("⏳ 基于上下文思考中...", 0);

    try {
      const client = new ContextQAClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);

      // 获取周围段落作为补充上下文（取文件前 500 字）
      let surroundingContext: string | undefined;
      if (sourceNotePath) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourceNotePath) as TFile | null;
        if (sourceFile) {
          const fullContent = await this.app.vault.read(sourceFile);
          surroundingContext = fullContent.slice(0, 500);
        }
      }

      const [response, history] = await Promise.all([
        client.ask({ question, context, sourceNote: sourceNotePath, surroundingContext }),
        graphManager.getQuestionHistory(),
      ]);

      notice.hide();

      // 分类
      const classifier = new QuestionClassifier(this.settings);
      const classifyNotice = new Notice("🔍 分析问题关系...", 0);
      const classification = await classifier.classify(question, history);
      classifyNotice.hide();

      new QuestionClassifyModal(this.app, question, classification, async (confirmed) => {
        const writeNotice = new Notice("✍️ 写入笔记...", 0);
        try {
          const writer = new VaultWriter(this.app, this.settings);
          const file = await writer.writeContextQANote(
            { question, context, sourceNote: sourceNotePath, surroundingContext },
            response
          );

          await graphManager.attachClassification(file, question, confirmed, response.concepts);
          await graphManager.appendRecommendations(file, confirmed);
          await graphManager.updateQuestionIndex(question, confirmed, file.path);

          writeNotice.hide();
          new Notice(`✅ 上下文笔记已生成：${file.name}`);

          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file);
        } catch (err) {
          writeNotice.hide();
          new Notice(`❌ 写入失败：${err.message}`);
          console.error("[IStart-Note-AI]", err);
        }
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 错误：${err.message}`);
      console.error("[IStart-Note-AI]", err);
    }
  }

  private openQuestionModal() {
    new QuestionModal(this.app, (question) => {
      this.processQuestion(question);
    }).open();
  }

  private async processQuestion(question: string) {
    // Step 1: 并行调用 DeepSeek 回答 + 问题分类
    const notice = new Notice("⏳ DeepSeek 思考中...", 0);

    try {
      const client = new DeepSeekClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);

      const [response, history] = await Promise.all([
        client.ask(question),
        graphManager.getQuestionHistory(),
      ]);

      notice.hide();

      // Step 2: 分类（后台静默进行，不阻塞笔记生成）
      const classifier = new QuestionClassifier(this.settings);
      const classifyNotice = new Notice("🔍 分析问题关系...", 0);
      const classification = await classifier.classify(question, history);
      classifyNotice.hide();

      // Step 3: 弹出分类确认弹窗
      new QuestionClassifyModal(this.app, question, classification, async (confirmed) => {
        const writeNotice = new Notice("✍️ 写入笔记...", 0);
        try {
          const writer = new VaultWriter(this.app, this.settings);
          const file = await writer.writeQANote(question, response);

          // Step 4: 附加问题图谱 frontmatter
          await graphManager.attachClassification(file, question, confirmed, response.concepts);

          // Step 5: 追加推荐问题
          await graphManager.appendRecommendations(file, confirmed);

          // Step 6: 更新问题索引页
          await graphManager.updateQuestionIndex(question, confirmed, file.path);

          writeNotice.hide();
          new Notice(`✅ 笔记已生成：${file.name}`);

          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file);

          if (this.settings.autoOpenGraph) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.app as any).commands.executeCommandById("graph:open");
          }
        } catch (err) {
          writeNotice.hide();
          new Notice(`❌ 写入失败：${err.message}`);
          console.error("[DeepSeek Plugin]", err);
        }
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 错误：${err.message}`);
      console.error("[DeepSeek Plugin]", err);
    }
  }

  private async openQuestionIndex() {
    const indexFolder = normalizePath(this.settings.questionsIndexPath);
    const indexPath = normalizePath(`${indexFolder}/问题索引.md`);
    let file = this.app.vault.getAbstractFileByPath(indexPath) as TFile | null;
    if (!file) {
      await this.app.vault.createFolder(indexFolder).catch(() => {});
      file = await this.app.vault.create(indexPath, "# 问题索引\n\n## 核心问题\n\n## 深化问题\n\n## 扩展问题\n");
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  private async completeCurrentConcept() {
    const manager = new ConceptPageManager(this.app, this.settings);
    const info = await manager.analyzeCurrentFile();

    if (!info) {
      new Notice("当前文件不是概念页，请打开 Knowledge/Concepts 下的概念文件");
      return;
    }

    new DepthSelectModal(this.app, info.conceptName, (depth) => {
      this.runConceptCompletion(info.file, info.conceptName, depth, {
        sourceQuestion: info.sourceQuestion,
        sourceAnswer: info.sourceAnswer,
      });
    }).open();
  }

  private async runConceptCompletion(
    file: TFile,
    conceptName: string,
    depth: CompletionDepth,
    context: { sourceQuestion?: string; sourceAnswer?: string }
  ) {
    const notice = new Notice(`⏳ 正在补全概念：${conceptName}...`, 0);

    try {
      const completer = new ConceptCompleter(this.settings);
      const result = await completer.complete(conceptName, depth, context);
      notice.hide();

      const manager = new ConceptPageManager(this.app, this.settings);
      const previewMd = manager.buildPreviewMarkdown(result, depth);

      new PreviewModal(
        this.app,
        conceptName,
        previewMd,
        async () => {
          await manager.writeCompletion(file, result, depth);
          new Notice(`✅ 概念页已补全：${conceptName}`);
          const leaf = this.app.workspace.getLeaf(false);
          await leaf.openFile(file);
        },
        () => {
          this.runConceptCompletion(file, conceptName, depth, context);
        }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 补全失败：${err.message}`);
      console.error("[DeepSeek Plugin]", err);
    }
  }

  private async scanAndBatchComplete() {
    const notice = new Notice("🔍 扫描空概念页中...", 0);
    const manager = new ConceptPageManager(this.app, this.settings);
    const empties = await manager.scanEmptyConcepts();
    notice.hide();

    const items = empties.map((e) => ({ name: e.conceptName, path: e.file.path }));

    new BatchScanModal(this.app, items, async (selectedPaths, depth) => {
      let done = 0;
      for (const path of selectedPaths) {
        const file = this.app.vault.getAbstractFileByPath(path) as TFile;
        if (!file) continue;
        const info = await manager.analyzeFile(file);
        if (!info) continue;

        const n = new Notice(`⏳ 补全中 (${++done}/${selectedPaths.length})：${info.conceptName}`, 0);
        try {
          const completer = new ConceptCompleter(this.settings);
          const result = await completer.complete(info.conceptName, depth, {
            sourceQuestion: info.sourceQuestion,
            sourceAnswer: info.sourceAnswer,
          });
          await manager.writeCompletion(file, result, depth);
          n.hide();
        } catch (err) {
          n.hide();
          new Notice(`❌ ${info.conceptName} 补全失败：${err.message}`);
        }
      }
      new Notice(`✅ 批量补全完成，共 ${done} 个概念页`);
    }).open();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
