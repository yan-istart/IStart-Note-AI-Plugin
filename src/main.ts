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
import { CommandPanelModal, buildPanelGroups } from "./features/command-panel/CommandPanelModal";

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("brain", "IStart-Note-AI", () => {
      this.openCommandPanel();
    });

    this.addRibbonIcon("cloud", "Baidu cloud sync status", () => {
      void this.activateSyncView();
    });

    this.registerView(SYNC_VIEW_TYPE, (leaf) => new BaiduSyncView(leaf, this));

    this.addCommand({
      id: "ask-deepseek",
      name: "Ask DeepSeek and generate a knowledge note",
      callback: () => this.openQuestionModal(),
    });

    // 命令：打开命令面板
    this.addCommand({
      id: "open-panel",
      name: "Open command panel",
      callback: () => this.openCommandPanel(),
    });

    this.addCommand({
      id: "complete-current-concept",
      name: "Complete current concept page",
      callback: () => { void this.completeCurrentConcept(); },
    });

    this.addCommand({
      id: "scan-empty-concepts",
      name: "Scan empty concept pages",
      callback: () => { void this.scanAndBatchComplete(); },
    });

    this.addCommand({
      id: "context-qa",
      name: "Ask based on selection",
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

    this.addCommand({
      id: "append-current-section",
      name: "Append content to current section",
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const content = editor.getValue();
        const appender = new SectionAppender(this.app, this.settings);
        const sectionName = appender.getSectionAtCursor(content, cursor.line);
        if (!sectionName) {
          new Notice("请将光标置于某个章节（## 标题）内");
          return;
        }
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        void this.runSectionAppend(activeFile, sectionName, content);
      },
    });

    this.addCommand({
      id: "open-question-index",
      name: "Open question index",
      callback: () => { void this.openQuestionIndex(); },
    });

    this.addCommand({
      id: "baidu-sync",
      name: "Baidu Netdisk sync / backup",
      callback: () => this.openBaiduSyncModal(),
    });

    this.addCommand({
      id: "baidu-sync-view",
      name: "Open Baidu cloud sync status panel",
      callback: () => { void this.activateSyncView(); },
    });

    this.addCommand({
      id: "baidu-auth",
      name: "Baidu Netdisk re-authorize",
      callback: () => this.openBaiduAuthModal(),
    });

    // 命令：生成图表/公式（选中文字）
    this.addCommand({
      id: "generate-diagram",
      name: "Generate diagram or formula from selection",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("请先选中一段文字作为图表/公式的描述");
          return;
        }
        const context = editor.getValue().slice(0, 800);
        this.openDiagramGenerator(selection, context, editor);
      },
    });

    // 命令：智能生成（自动判断类型）
    this.addCommand({
      id: "smart-diagram",
      name: "Smart generate (auto-detect type)",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("请先选中一段文字");
          return;
        }
        const context = editor.getValue().slice(0, 800);
        void this.runDiagramGeneration(selection, "auto", context, editor);
      },
    });

    // 命令：智能补全（自动判断场景）
    this.addCommand({
      id: "smart-complete",
      name: "Smart complete (auto-detect context)",
      editorCallback: (editor) => {
        void this.runSmartComplete(editor);
      },
    });

    // 命令：扩写选中内容
    this.addCommand({
      id: "expand-selection",
      name: "Expand selected text",
      editorCallback: (editor) => {
        const selection = editor.getSelection().trim();
        if (!selection) {
          new Notice("请先选中要扩写的文字");
          return;
        }
        const context = editor.getValue().slice(0, 1500);
        void this.runExpand(selection, context, editor);
      },
    });

    // 命令：续写
    this.addCommand({
      id: "continue-writing",
      name: "Continue writing from cursor",
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const beforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
        if (!beforeCursor.trim()) {
          new Notice("光标前没有内容可续写");
          return;
        }
        void this.runContinue(beforeCursor, editor);
      },
    });

    // 命令：分析文档缺失
    this.addCommand({
      id: "analyze-document",
      name: "Analyze document and suggest completions",
      editorCallback: (editor) => {
        const content = editor.getValue();
        if (!content.trim()) {
          new Notice("文档为空");
          return;
        }
        void this.runDocumentAnalysis(content, editor);
      },
    });

    // 命令：新建阅读项目
    this.addCommand({
      id: "new-reading-project",
      name: "New reading project (book study)",
      callback: () => this.openNewReadingProject(),
    });

    // 命令：生成章节总结
    this.addCommand({
      id: "chapter-summary",
      name: "Generate chapter summary",
      editorCallback: (editor) => {
        void this.runChapterSummary(editor);
      },
    });

    // 命令：费曼检验
    this.addCommand({
      id: "feynman-test",
      name: "Feynman test (check understanding)",
      editorCallback: (editor) => {
        void this.runFeynmanTest(editor);
      },
    });

    // 命令：补全阅读项目（断点续传）
    this.addCommand({
      id: "resume-reading-project",
      name: "Resume reading project (complete missing chapters)",
      callback: () => { void this.resumeReadingProject(); },
    });

    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

        const fileMeta = this.app.metadataCache.getFileCache(file);
        const fileType = fileMeta?.frontmatter?.type as string | undefined;

        // 通用：智能补全（对任何 md 文件可用）
        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI: Smart complete")
            .setIcon("sparkles")
            .onClick(() => {
              void (async () => {
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);
                // 等文件打开后执行智能补全
                setTimeout(() => {
                  const editor = this.app.workspace.activeEditor?.editor;
                  if (editor) void this.runSmartComplete(editor);
                }, 200);
              })();
            });
        });

        // 概念页：补全概念
        if (fileType === "concept" || file.path.includes("Concepts/")) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Complete this concept page")
              .setIcon("brain")
              .onClick(() => {
                void (async () => {
                  const manager = new ConceptPageManager(this.app, this.settings);
                  const info = await manager.analyzeFile(file);
                  if (!info) {
                    new Notice("该文件不是概念页");
                    return;
                  }
                  new DepthSelectModal(this.app, info.conceptName, (depth) => {
                    void this.runConceptCompletion(info.file, info.conceptName, depth, {
                      sourceQuestion: info.sourceQuestion,
                      sourceAnswer: info.sourceAnswer,
                    });
                  }).open();
                })();
              });
          });
        }

        // 阅读项目索引页：补全缺失章节
        if (fileType === "reading-project") {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Resume reading project")
              .setIcon("refresh-cw")
              .onClick(() => { void this.resumeReadingProject(); });
          });
        }

        // 阅读章节笔记：生成总结 / 费曼检验
        if (fileType === "reading-note") {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Generate chapter summary")
              .setIcon("file-text")
              .onClick(() => {
                void (async () => {
                  const leaf = this.app.workspace.getLeaf(false);
                  await leaf.openFile(file);
                  setTimeout(() => {
                    const editor = this.app.workspace.activeEditor?.editor;
                    if (editor) void this.runChapterSummary(editor);
                  }, 200);
                })();
              });
          });

          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Feynman test")
              .setIcon("help-circle")
              .onClick(() => {
                void (async () => {
                  const leaf = this.app.workspace.getLeaf(false);
                  await leaf.openFile(file);
                  setTimeout(() => {
                    const editor = this.app.workspace.activeEditor?.editor;
                    if (editor) void this.runFeynmanTest(editor);
                  }, 200);
                })();
              });
          });
        }
      })
    );

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection().trim();

        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Ask based on selection")
              .setIcon("message-circle")
              .onClick(() => {
                const activeFile = this.app.workspace.getActiveFile();
                this.openContextQAModal(selection, activeFile?.path ?? "");
              });
          });

          // 图表/公式生成入口
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Generate diagram / formula")
              .setIcon("bar-chart-2")
              .onClick(() => {
                const context = editor.getValue().slice(0, 800);
                this.openDiagramGenerator(selection, context, editor);
              });
          });

          // 扩写选中内容
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Expand selection")
              .setIcon("expand")
              .onClick(() => {
                const context = editor.getValue().slice(0, 1500);
                void this.runExpand(selection, context, editor);
              });
          });
        }

        const cursor = editor.getCursor();
        const fullContent = editor.getValue();
        const appender = new SectionAppender(this.app, this.settings);
        const sectionAtCursor = appender.getSectionAtCursor(fullContent, cursor.line);
        if (sectionAtCursor) {
          menu.addItem((item) => {
            item
              .setTitle(`IStart-Note-AI: Append to "${sectionAtCursor}"`)
              .setIcon("plus-circle")
              .onClick(() => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return;
                void this.runSectionAppend(activeFile, sectionAtCursor, fullContent);
              });
          });
        }

        const linkMatch = selection.match(/^\[\[(.+?)(?:\|.+?)?\]\]$/) ||
          selection.match(/^(.+)$/);
        const conceptName = linkMatch?.[1];

        if (conceptName) {
          menu.addItem((item) => {
            item
              .setTitle(`IStart-Note-AI: Complete concept "${conceptName}"`)
              .setIcon("brain")
              .onClick(() => {
                void (async () => {
                  const manager = new ConceptPageManager(this.app, this.settings);
                  const conceptsPath = this.settings.conceptsPath || "Knowledge/Concepts";

                  // 在所有子目录中查找概念文件
                  let conceptFile: TFile | null = null;
                  const allFiles = this.app.vault.getMarkdownFiles();
                  const found = allFiles.find(
                    (f) => f.path.startsWith(conceptsPath) && f.basename === conceptName
                  );
                  if (found) {
                    conceptFile = found;
                  }

                  if (!conceptFile) {
                    const writer = new VaultWriter(this.app, this.settings);
                    await writer.ensureConceptNote(conceptName);
                    // 重新查找（现在在 _未分类/ 下）
                    const created = this.app.vault.getMarkdownFiles().find(
                      (f) => f.path.startsWith(conceptsPath) && f.basename === conceptName
                    );
                    if (created) conceptFile = created;
                    else {
                      // 直接用路径查找
                      const uncatPath = `${conceptsPath}/_未分类/${conceptName}.md`;
                      const uncatFile = this.app.vault.getAbstractFileByPath(uncatPath);
                      if (uncatFile instanceof TFile) conceptFile = uncatFile;
                    }
                  }

                  if (!conceptFile) {
                    new Notice(`无法找到或创建概念页：${conceptName}`);
                    return;
                  }

                  const targetFile = conceptFile;
                  const info = await manager.analyzeFile(targetFile);
                  new DepthSelectModal(this.app, conceptName, (depth) => {
                    void this.runConceptCompletion(targetFile, conceptName, depth, {
                      sourceQuestion: info?.sourceQuestion,
                      sourceAnswer: info?.sourceAnswer,
                    });
                  }).open();
                })();
              });
          });
        }

        // 根据文件类型显示对应操作
        const activeFile = this.app.workspace.getActiveFile();
        const activeMeta = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
        const activeType = activeMeta?.frontmatter?.type as string | undefined;
        const isConceptPage = activeType === "concept" || (activeFile?.path.includes("Concepts/") ?? false);
        const isReadingNote = activeType === "reading-note";
        const isReadingProject = activeType === "reading-project";

        if (isConceptPage) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Complete current concept page")
              .setIcon("brain")
              .onClick(() => { void this.completeCurrentConcept(); });
          });
        }

        if (isReadingNote) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Generate chapter summary")
              .setIcon("file-text")
              .onClick(() => { void this.runChapterSummary(editor); });
          });
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Feynman test")
              .setIcon("help-circle")
              .onClick(() => { void this.runFeynmanTest(editor); });
          });
        }

        if (isReadingProject) {
          menu.addItem((item) => {
            item
              .setTitle("IStart-Note-AI: Resume reading project")
              .setIcon("refresh-cw")
              .onClick(() => { void this.resumeReadingProject(); });
          });
        }

        // 智能补全（始终可用）
        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI: Smart complete")
            .setIcon("sparkles")
            .onClick(() => { void this.runSmartComplete(editor); });
        });

        // 分析文档（始终可用）
        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI: Analyze and suggest")
            .setIcon("search")
            .onClick(() => {
              const content = editor.getValue();
              void this.runDocumentAnalysis(content, editor);
            });
        });
      })
    );
  }

  private openCommandPanel() {
    const editor = this.app.workspace.activeEditor?.editor;
    const activeFile = this.app.workspace.getActiveFile();
    const selection = editor?.getSelection().trim() ?? "";
    const hasSelection = selection.length > 0;

    // 判断当前文件类型
    const meta = activeFile ? this.app.metadataCache.getFileCache(activeFile) : null;
    const fm = meta?.frontmatter;
    const isConceptPage = fm?.type === "concept" || (activeFile?.path.includes("Concepts/") ?? false);
    const isReadingNote = fm?.type === "reading-note";

    // 判断光标是否在 section 内
    let isInSection = false;
    let sectionName: string | null = null;
    if (editor) {
      const cursor = editor.getCursor();
      const content = editor.getValue();
      const appender = new SectionAppender(this.app, this.settings);
      sectionName = appender.getSectionAtCursor(content, cursor.line);
      isInSection = sectionName !== null;
    }

    const groups = buildPanelGroups({
      hasSelection,
      selection,
      isConceptPage,
      isReadingNote,
      isInSection,
      sectionName,
      activeFile,
      onAsk: () => this.openQuestionModal(),
      onContextQA: () => {
        if (editor && hasSelection) {
          this.openContextQAModal(selection, activeFile?.path ?? "");
        }
      },
      onNewReading: () => this.openNewReadingProject(),
      onSmartComplete: () => { if (editor) void this.runSmartComplete(editor); },
      onDiagram: () => {
        if (editor && hasSelection) {
          const context = editor.getValue().slice(0, 800);
          this.openDiagramGenerator(selection, context, editor);
        }
      },
      onExpand: () => {
        if (editor && hasSelection) {
          const context = editor.getValue().slice(0, 1500);
          void this.runExpand(selection, context, editor);
        }
      },
      onContinue: () => {
        if (editor) {
          const cursor = editor.getCursor();
          const before = editor.getRange({ line: 0, ch: 0 }, cursor);
          void this.runContinue(before, editor);
        }
      },
      onCompleteConcept: () => { void this.completeCurrentConcept(); },
      onScanConcepts: () => { void this.scanAndBatchComplete(); },
      onChapterSummary: () => { if (editor) void this.runChapterSummary(editor); },
      onFeynmanTest: () => { if (editor) void this.runFeynmanTest(editor); },
      onAnalyzeDoc: () => {
        if (editor) {
          const content = editor.getValue();
          void this.runDocumentAnalysis(content, editor);
        }
      },
      onSectionAppend: () => {
        if (editor && activeFile && sectionName) {
          const content = editor.getValue();
          void this.runSectionAppend(activeFile, sectionName, content);
        }
      },
    });

    new CommandPanelModal(this.app, groups).open();
  }

  private openContextQAModal(selectedText: string, sourceNotePath: string) {
    new ContextQAModal(this.app, selectedText, (question) => {
      void this.processContextQA(question, selectedText, sourceNotePath);
    }).open();
  }

  private async processContextQA(question: string, context: string, sourceNotePath: string) {
    const notice = new Notice("⏳ 基于上下文思考中...", 0);

    try {
      const client = new ContextQAClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);

      let surroundingContext: string | undefined;
      if (sourceNotePath) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourceNotePath);
        if (sourceFile instanceof TFile) {
          const fullContent = await this.app.vault.read(sourceFile);
          surroundingContext = fullContent.slice(0, 500);
        }
      }

      const [response, history] = await Promise.all([
        client.ask({ question, context, sourceNote: sourceNotePath, surroundingContext }),
        Promise.resolve(graphManager.getQuestionHistory()),
      ]);

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

            void this.triggerAutoBackup(file.path);
          } catch (err) {
            writeNotice.hide();
            new Notice(`❌ 写入失败：${(err as Error).message}`);
            console.error("[IStart-Note-AI]", err);
          }
        })();
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 错误：${(err as Error).message}`);
      console.error("[IStart-Note-AI]", err);
    }
  }

  private openQuestionModal() {
    new QuestionModal(this.app, (question) => {
      void this.processQuestion(question);
    }).open();
  }

  private async processQuestion(question: string) {
    const notice = new Notice("⏳ DeepSeek 思考中...", 0);

    try {
      const client = new DeepSeekClient(this.settings);
      const graphManager = new QuestionGraphManager(this.app, this.settings);

      const [response, history] = await Promise.all([
        client.ask(question),
        Promise.resolve(graphManager.getQuestionHistory()),
      ]);

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
              const appWithCommands = this.app as unknown as { commands: { executeCommandById: (id: string) => void } };
              appWithCommands.commands.executeCommandById("graph:open");
            }

            void this.triggerAutoBackup(file.path);
          } catch (err) {
            writeNotice.hide();
            new Notice(`❌ 写入失败：${(err as Error).message}`);
            console.error("[DeepSeek Plugin]", err);
          }
        })();
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 错误：${(err as Error).message}`);
      console.error("[DeepSeek Plugin]", err);
    }
  }

  private async openQuestionIndex() {
    const indexFolder = normalizePath(this.settings.questionsIndexPath);
    const indexPath = normalizePath(`${indexFolder}/问题索引.md`);
    let file = this.app.vault.getAbstractFileByPath(indexPath);
    if (!file || !(file instanceof TFile)) {
      try { await this.app.vault.createFolder(indexFolder); } catch { /* exists */ }
      file = await this.app.vault.create(indexPath, "# 问题索引\n\n## 核心问题\n\n## 深化问题\n\n## 扩展问题\n");
    }
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    }
  }

  private async completeCurrentConcept() {
    const manager = new ConceptPageManager(this.app, this.settings);
    const info = await manager.analyzeCurrentFile();

    if (!info) {
      new Notice("当前文件不是概念页，请打开 Knowledge/Concepts 下的概念文件");
      return;
    }

    new DepthSelectModal(this.app, info.conceptName, (depth) => {
      void this.runConceptCompletion(info.file, info.conceptName, depth, {
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
        () => {
          void (async () => {
            await manager.writeCompletion(file, result, depth);
            new Notice(`✅ 概念页已补全：${conceptName}`);
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(file);
          })();
        },
        () => {
          void this.runConceptCompletion(file, conceptName, depth, context);
        }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 补全失败：${(err as Error).message}`);
      console.error("[DeepSeek Plugin]", err);
    }
  }

  private runSectionAppend(file: TFile, sectionName: string, content: string) {
    const appender = new SectionAppender(this.app, this.settings);
    const section = appender.extractSection(content, sectionName);
    const existingItems = section?.existing
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .length ?? 0;

    const meta = this.app.metadataCache.getFileCache(file);
    const conceptName = (meta?.frontmatter?.name as string) || file.basename;

    new SectionAppendModal(this.app, sectionName, existingItems, (count) => {
      void this.generateAndPreviewSection(file, conceptName, sectionName, section?.existing ?? "", count);
    }).open();
  }

  private async generateAndPreviewSection(
    file: TFile,
    conceptName: string,
    sectionName: string,
    existingContent: string,
    count: number
  ) {
    const notice = new Notice(`⏳ 生成"${sectionName}"补充内容...`, 0);
    try {
      const appender = new SectionAppender(this.app, this.settings);
      const result = await appender.generate(conceptName, sectionName, existingContent, count);
      notice.hide();

      new SectionPreviewModal(
        this.app,
        sectionName,
        result.items,
        () => {
          void (async () => {
            await appender.appendToSection(file, sectionName, result.items);
            new Notice(`✅ 已追加 ${result.items.length} 条内容到"${sectionName}"`);
          })();
        },
        () => {
          void this.generateAndPreviewSection(file, conceptName, sectionName, existingContent, count);
        }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 生成失败：${(err as Error).message}`);
    }
  }

  private async scanAndBatchComplete() {
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
            const result = await completer.complete(info.conceptName, depth, {
              sourceQuestion: info.sourceQuestion,
              sourceAnswer: info.sourceAnswer,
            });
            await manager.writeCompletion(abstract, result, depth);
            n.hide();
          } catch (err) {
            n.hide();
            new Notice(`❌ ${info.conceptName} 补全失败：${(err as Error).message}`);
          }
        }
        new Notice(`✅ 批量补全完成，共 ${done} 个概念页`);
      })();
    }).open();
  }

  private async activateSyncView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(SYNC_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: SYNC_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private openBaiduSyncModal() {
    if (!this.settings.baiduSync.enabled) {
      new Notice("请先在设置中启用百度云同步");
      return;
    }
    new BaiduSyncModal(this.app, this.settings.baiduSync, async (accessToken, expiresAt) => {
      this.settings.baiduSync.accessToken = accessToken;
      this.settings.baiduSync.tokenExpiresAt = expiresAt;
      await this.saveSettings();
    }).open();
  }

  private openBaiduAuthModal() {
    if (!this.settings.baiduSync.enabled) {
      new Notice("请先在设置中启用百度云同步");
      return;
    }
    new BaiduAuthModal(this.app, this.settings.baiduSync, (accessToken, refreshToken, expiresAt) => {
      void (async () => {
        this.settings.baiduSync.accessToken = accessToken;
        this.settings.baiduSync.refreshToken = refreshToken;
        this.settings.baiduSync.tokenExpiresAt = expiresAt;
        await this.saveSettings();
      })();
    }).open();
  }

  // ── 阅读项目 ─────────────────────────────────────────────

  private openNewReadingProject() {
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
      const indexFile = await manager.createProject(plan, (current, total, chapter) => {
        notice.setMessage(`⏳ 生成预设问题 (${current}/${total})：${chapter}`);
      });
      notice.hide();

      new Notice(`✅ 阅读项目已创建：${plan.bookTitle}（${plan.chapters.length} 章）`);
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(indexFile);
    } catch (err) {
      notice.hide();
      new Notice(`❌ 创建失败：${(err as Error).message}`);
      console.error("[IStart-Note-AI]", err);
    }
  }

  private async resumeReadingProject() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开阅读项目的索引页"); return; }

    const meta = this.app.metadataCache.getFileCache(activeFile);
    if (meta?.frontmatter?.type !== "reading-project") {
      new Notice("当前文件不是阅读项目索引页");
      return;
    }

    const notice = new Notice("⏳ 补全缺失章节...", 0);
    try {
      const manager = new ReadingProjectManager(this.app, this.settings);
      const count = await manager.resumeProject(activeFile, (current, total, chapter) => {
        notice.setMessage(`⏳ 补全 (${current}/${total})：${chapter}`);
      });
      notice.hide();

      if (count === 0) {
        new Notice("✅ 所有章节已完整，无需补全");
      } else {
        new Notice(`✅ 已补全 ${count} 个章节的预设问题`);
      }
    } catch (err) {
      notice.hide();
      new Notice(`❌ 补全失败：${(err as Error).message}`);
    }
  }

  private async runChapterSummary(editor: import("obsidian").Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开一个章节笔记"); return; }

    const content = editor.getValue();
    const meta = this.app.metadataCache.getFileCache(activeFile);
    const fm = meta?.frontmatter;

    if (fm?.type !== "reading-note") {
      new Notice("当前文件不是阅读章节笔记");
      return;
    }

    const book = (fm.book as string) || "未知";
    const chapter = `第${fm.chapter}章：${fm.title}`;

    // 提取预设问题
    const questionsMatch = content.match(/## 读前问题\n([\s\S]*?)(?=\n## )/);
    const questions = questionsMatch
      ? questionsMatch[1].split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.replace(/^- \[.\]\s*/, "").trim())
      : [];

    const notice = new Notice("⏳ 生成章节总结...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const result = await planner.summarizeChapter(book, chapter, content, questions);
      notice.hide();

      const manager = new ReadingProjectManager(this.app, this.settings);
      await manager.writeChapterSummary(activeFile, result);
      new Notice("✅ 章节总结已生成");

      // 刷新编辑器
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(activeFile);
    } catch (err) {
      notice.hide();
      new Notice(`❌ 生成失败：${(err as Error).message}`);
    }
  }

  private async runFeynmanTest(editor: import("obsidian").Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) { new Notice("请先打开一个章节笔记"); return; }

    const content = editor.getValue();
    const meta = this.app.metadataCache.getFileCache(activeFile);
    const fm = meta?.frontmatter;

    if (fm?.type !== "reading-note") {
      new Notice("当前文件不是阅读章节笔记");
      return;
    }

    const book = (fm.book as string) || "未知";
    const chapter = `第${fm.chapter}章：${fm.title}`;

    // 提取概念
    const conceptsMatch = content.match(/## 关联概念\n([\s\S]*?)(?=\n## |$)/);
    const concepts = conceptsMatch
      ? conceptsMatch[1].match(/\[\[(.+?)\]\]/g)?.map((m) => m.replace(/\[\[|\]\]/g, "")) ?? []
      : [];

    const notice = new Notice("⏳ 生成检验问题...", 0);
    try {
      const planner = new ReadingPlanner(this.settings);
      const questions = await planner.feynmanTest(book, chapter, concepts, content);
      notice.hide();

      new FeynmanModal(this.app, chapter, questions).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 生成失败：${(err as Error).message}`);
    }
  }

  // ── 智能补全 ─────────────────────────────────────────────

  /**
   * 智能补全：自动判断场景
   * - 有选中文字 → 扩写
   * - 光标在空 section 内 → 补全该 section
   * - 否则 → 续写
   */
  private async runSmartComplete(editor: import("obsidian").Editor) {
    const selection = editor.getSelection().trim();

    if (selection) {
      // 场景 A：扩写选中内容
      const context = editor.getValue().slice(0, 1500);
      await this.runExpand(selection, context, editor);
      return;
    }

    // 检查光标是否在空 section 内
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const lines = content.split("\n");

    // 向上找最近的 ## 标题
    let sectionName: string | null = null;
    let sectionStartLine = -1;
    for (let i = cursor.line; i >= 0; i--) {
      const match = lines[i]?.match(/^##\s+(.+)/);
      if (match) {
        sectionName = match[1].trim();
        sectionStartLine = i;
        break;
      }
    }

    if (sectionName && sectionStartLine >= 0) {
      // 检查该 section 是否为空（标题到下一个 ## 之间没有非空行）
      let sectionEmpty = true;
      for (let i = sectionStartLine + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) break;
        if (lines[i].trim().length > 0) { sectionEmpty = false; break; }
      }

      if (sectionEmpty) {
        // 场景 B：补全空 section
        const activeFile = this.app.workspace.getActiveFile();
        const title = activeFile?.basename ?? "未知";
        await this.runSectionComplete(title, sectionName, content, sectionStartLine, editor);
        return;
      }
    }

    // 场景 C：续写
    const beforeCursor = editor.getRange({ line: 0, ch: 0 }, cursor);
    await this.runContinue(beforeCursor, editor);
  }

  private async runExpand(selection: string, context: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 扩写中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.expand(selection, context);
      notice.hide();

      new SmartPreviewModal(
        this.app,
        "扩写预览",
        result.content,
        () => {
          // 替换选中内容
          editor.replaceSelection(result.content);
          new Notice("✅ 已扩写");
        },
        () => { void this.runExpand(selection, context, editor); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 扩写失败：${(err as Error).message}`);
    }
  }

  private async runContinue(beforeCursor: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 续写中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.continueWriting(beforeCursor);
      notice.hide();

      new SmartPreviewModal(
        this.app,
        "续写预览",
        result.content,
        () => {
          const cursor = editor.getCursor();
          editor.replaceRange("\n" + result.content, cursor);
          new Notice("✅ 已续写");
        },
        () => { void this.runContinue(beforeCursor, editor); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 续写失败：${(err as Error).message}`);
    }
  }

  private async runSectionComplete(
    title: string,
    sectionName: string,
    fileContent: string,
    sectionStartLine: number,
    editor: import("obsidian").Editor
  ) {
    const notice = new Notice(`⏳ 补全"${sectionName}"...`, 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const result = await completer.completeSection(title, sectionName, fileContent);
      notice.hide();

      new SmartPreviewModal(
        this.app,
        `补全"${sectionName}"`,
        result.content,
        () => {
          // 插入到 section 标题下方
          const insertLine = sectionStartLine + 1;
          const insertPos = { line: insertLine, ch: 0 };
          editor.replaceRange(result.content + "\n\n", insertPos);
          new Notice(`✅ 已补全"${sectionName}"`);
        },
        () => { void this.runSectionComplete(title, sectionName, fileContent, sectionStartLine, editor); }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 补全失败：${(err as Error).message}`);
    }
  }

  private async runDocumentAnalysis(content: string, editor: import("obsidian").Editor) {
    const notice = new Notice("⏳ 分析文档中...", 0);
    try {
      const completer = new SmartCompleter(this.settings);
      const suggestions = await completer.analyzeDocument(content);
      notice.hide();

      new DocumentAnalysisModal(this.app, suggestions, (selected) => {
        // 将选中的建议追加到文档末尾
        const parts = selected.map((s) => `## ${s.section}\n${s.content}`);
        const insertText = "\n\n" + parts.join("\n\n") + "\n";
        const lastLine = editor.lastLine();
        editor.replaceRange(insertText, { line: lastLine, ch: editor.getLine(lastLine).length });
        new Notice(`✅ 已插入 ${selected.length} 处补充内容`);
      }).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 分析失败：${(err as Error).message}`);
    }
  }

  // ── 图表/公式生成 ─────────────────────────────────────────

  private openDiagramGenerator(selection: string, context: string, editor: import("obsidian").Editor) {
    new DiagramTypeModal(this.app, (type) => {
      void this.runDiagramGeneration(selection, type, context, editor);
    }).open();
  }

  private async runDiagramGeneration(
    selection: string,
    type: DiagramType,
    context: string,
    editor: import("obsidian").Editor
  ) {
    const notice = new Notice(`⏳ 生成${type === "auto" ? "图表" : type}中...`, 0);

    try {
      const generator = new DiagramGenerator(this.settings);
      const result = await generator.generate(selection, type, context);
      notice.hide();

      const formatted = generator.formatForInsert(result);

      new DiagramPreviewModal(
        this.app,
        result,
        formatted,
        () => {
          // 插入到选中文字下方
          const cursor = editor.getCursor("to");
          const insertPos = { line: cursor.line + 1, ch: 0 };
          const insertText = `\n${formatted}\n`;
          editor.replaceRange(insertText, insertPos);
          new Notice(`✅ 已插入${result.typeName}`);
        },
        () => {
          void this.runDiagramGeneration(selection, type, context, editor);
        },
        (instruction) => {
          void this.runDiagramRefine(result.code, instruction, editor);
        }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 生成失败：${(err as Error).message}`);
    }
  }

  private async runDiagramRefine(
    existingCode: string,
    instruction: string,
    editor: import("obsidian").Editor
  ) {
    const notice = new Notice("⏳ 优化图表中...", 0);

    try {
      const generator = new DiagramGenerator(this.settings);
      const result = await generator.refine(existingCode, instruction);
      notice.hide();

      const formatted = generator.formatForInsert(result);

      new DiagramPreviewModal(
        this.app,
        result,
        formatted,
        () => {
          const cursor = editor.getCursor("to");
          const insertPos = { line: cursor.line + 1, ch: 0 };
          editor.replaceRange(`\n${formatted}\n`, insertPos);
          new Notice(`✅ 已插入优化后的${result.typeName}`);
        },
        () => {
          void this.runDiagramRefine(existingCode, instruction, editor);
        },
        (newInstruction) => {
          void this.runDiagramRefine(result.code, newInstruction, editor);
        }
      ).open();
    } catch (err) {
      notice.hide();
      new Notice(`❌ 优化失败：${(err as Error).message}`);
    }
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
    } catch {
      // 自动备份失败静默处理
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.baiduSync = Object.assign({}, DEFAULT_BAIDU_SYNC_CONFIG, this.settings.baiduSync);

    if (this.settings.baiduSync.enabled && this.settings.baiduSync.accessToken) {
      void this.pullConfig(true);
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async pushConfig() {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) {
      new Notice("请先启用百度云同步并完成授权");
      return;
    }
    const service = new BaiduSyncService(this.app, cfg);
    const adapter = this.app.vault.adapter as unknown as { basePath?: string };
    const basePath = adapter.basePath ?? "unknown-device";
    const ok = await service.pushConfig(this.settings, basePath);
    new Notice(ok ? "✅ 配置已推送到百度云" : "❌ 配置推送失败");
  }

  async pullConfig(silent = false) {
    const cfg = this.settings.baiduSync;
    if (!cfg.enabled || !cfg.accessToken) return;

    const service = new BaiduSyncService(this.app, cfg);
    const remote = await service.pullConfig(undefined);
    if (!remote) {
      if (!silent) new Notice("远端无配置或已是最新");
      return;
    }

    this.settings = BaiduSyncService.applyRemoteConfig(this.settings, remote);
    await this.saveData(this.settings);
    if (!silent) new Notice(`✅ 已从百度云拉取配置（由 ${remote.deviceId} 于 ${remote.updatedAt.slice(0, 10)} 推送）`);
  }
}
