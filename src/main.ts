import { Notice, Plugin } from "obsidian";
import { DeepSeekSettings, DEFAULT_SETTINGS } from "./types";
import { DeepSeekClient } from "./DeepSeekClient";
import { VaultWriter } from "./VaultWriter";
import { QuestionModal } from "./QuestionModal";
import { DeepSeekSettingsTab } from "./SettingsTab";

export default class DeepSeekPlugin extends Plugin {
  settings: DeepSeekSettings;

  async onload() {
    await this.loadSettings();

    // 侧边栏图标
    this.addRibbonIcon("brain", "DeepSeek 提问", () => {
      this.openQuestionModal();
    });

    // 命令面板
    this.addCommand({
      id: "ask-deepseek",
      name: "向 DeepSeek 提问并生成知识笔记",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "d" }],
      callback: () => this.openQuestionModal(),
    });

    // 设置页
    this.addSettingTab(new DeepSeekSettingsTab(this.app, this));
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

      // 打开生成的笔记
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);

      // 可选：打开 Graph View
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
