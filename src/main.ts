import { Notice, Plugin, TFile } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS, CompletionDepth } from "./types";
import { DeepSeekClient } from "./DeepSeekClient";
import { VaultWriter } from "./VaultWriter";
import { QuestionModal } from "./QuestionModal";
import { DeepSeekSettingsTab } from "./SettingsTab";
import { ConceptCompleter } from "./ConceptCompleter";
import { ConceptPageManager } from "./ConceptPageManager";
import { DepthSelectModal, PreviewModal, BatchScanModal } from "./ConceptCompletionModal";

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

    // 设置页
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));

    // 文件列表右键菜单
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;

        menu.addItem((item) => {
          item
            .setTitle("DeepSeek：补全此概念页")
            .setIcon("brain")
            .onClick(async () => {
              const manager = new ConceptPageManager(this.app);
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
        // 检查选中文字是否是 [[概念]] 格式
        const selection = editor.getSelection().trim();
        const linkMatch = selection.match(/^\[\[(.+?)(?:\|.+?)?\]\]$/) ||
          selection.match(/^(.+)$/);
        const conceptName = linkMatch?.[1];
        if (!conceptName) return;

        menu.addItem((item) => {
          item
            .setTitle(`DeepSeek：补全概念 "${conceptName}"`)
            .setIcon("brain")
            .onClick(async () => {
              const manager = new ConceptPageManager(this.app);
              // 尝试找到对应概念页文件
              const conceptsPath = this.settings.conceptsPath || "Knowledge/Concepts";
              const filePath = `${conceptsPath}/${conceptName}.md`;
              let file = this.app.vault.getAbstractFileByPath(filePath) as TFile | null;

              // 不存在则先创建
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

        // 当前文件是概念页时，也提供补全入口
        menu.addItem((item) => {
          item
            .setTitle("DeepSeek：补全当前概念页")
            .setIcon("brain")
            .onClick(() => this.completeCurrentConcept());
        });
      })
    );
  }

  private openQuestionModal() {
    new QuestionModal(this.app, (question) => {
      this.processQuestion(question);
    }).open();
  }

  private async processQuestion(question: string) {
    const notice = new Notice("⏳ DeepSeek 思考中...", 0);

    try {
      const client = new DeepSeekClient(this.settings);
      const response = await client.ask(question);

      const writer = new VaultWriter(this.app, this.settings);
      const file = await writer.writeQANote(question, response);

      notice.hide();
      new Notice(`✅ 笔记已生成：${file.name}`);

      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      if (this.settings.autoOpenGraph) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.app as any).commands.executeCommandById("graph:open");
      }
    } catch (err) {
      notice.hide();
      new Notice(`❌ 错误：${err.message}`);
      console.error("[DeepSeek Plugin]", err);
    }
  }

  private async completeCurrentConcept() {
    const manager = new ConceptPageManager(this.app);
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

      const manager = new ConceptPageManager(this.app);
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
    const manager = new ConceptPageManager(this.app);
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
