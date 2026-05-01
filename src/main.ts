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
import { SectionAppender } from "./SectionAppender";
import { SectionAppendModal, SectionPreviewModal } from "./SectionAppendModal";
import { BaiduSyncService } from "./BaiduSyncService";
import { BaiduAuthModal } from "./BaiduAuthModal";
import { BaiduSyncModal } from "./BaiduSyncModal";
import { DEFAULT_BAIDU_SYNC_CONFIG } from "./types";
import { BaiduSyncView, SYNC_VIEW_TYPE } from "./BaiduSyncView";

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("brain", "DeepSeek ask", () => {
      this.openQuestionModal();
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

    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

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
        if (!conceptName) return;

        menu.addItem((item) => {
          item
            .setTitle(`IStart-Note-AI: Complete concept "${conceptName}"`)
            .setIcon("brain")
            .onClick(() => {
              void (async () => {
                const manager = new ConceptPageManager(this.app, this.settings);
                const conceptsPath = this.settings.conceptsPath || "Knowledge/Concepts";
                const filePath = `${conceptsPath}/${conceptName}.md`;
                let conceptFile = this.app.vault.getAbstractFileByPath(filePath);

                if (!conceptFile || !(conceptFile instanceof TFile)) {
                  const writer = new VaultWriter(this.app, this.settings);
                  await writer.ensureConceptNote(conceptName);
                  conceptFile = this.app.vault.getAbstractFileByPath(filePath);
                }

                if (!conceptFile || !(conceptFile instanceof TFile)) {
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

        menu.addItem((item) => {
          item
            .setTitle("IStart-Note-AI: Complete current concept page")
            .setIcon("brain")
            .onClick(() => { void this.completeCurrentConcept(); });
        });
      })
    );
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
    workspace.revealLeaf(leaf);
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
