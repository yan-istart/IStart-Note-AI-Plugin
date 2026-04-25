import { App, PluginSettingTab, Setting } from "obsidian";
import type DeepSeekPlugin from "./main";

export class DeepSeekSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: DeepSeekPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "DeepSeek Knowledge Graph 设置" });

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("DeepSeek API Key（在 platform.deepseek.com 获取）")
      .addText((text) =>
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("API 地址，默认 https://api.deepseek.com")
      .addText((text) =>
        text
          .setPlaceholder("https://api.deepseek.com")
          .setValue(this.plugin.settings.baseUrl)
          .onChange(async (value) => {
            this.plugin.settings.baseUrl = value.trim() || "https://api.deepseek.com";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("模型")
      .setDesc("选择使用的 DeepSeek 模型")
      .addDropdown((drop) =>
        drop
          .addOption("deepseek-chat", "deepseek-chat（推荐）")
          .addOption("deepseek-reasoner", "deepseek-reasoner（深度推理）")
          .setValue(this.plugin.settings.model)
          .onChange(async (value: "deepseek-chat" | "deepseek-reasoner") => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("笔记保存路径")
      .setDesc("Q&A 笔记存储目录（相对于 Vault 根目录）")
      .addText((text) =>
        text
          .setPlaceholder("Knowledge/Q&A")
          .setValue(this.plugin.settings.savePath)
          .onChange(async (value) => {
            this.plugin.settings.savePath = value.trim() || "Knowledge/Q&A";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动打开 Graph View")
      .setDesc("生成笔记后自动打开图谱视图")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenGraph)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenGraph = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
