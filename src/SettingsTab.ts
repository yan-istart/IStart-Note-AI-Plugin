import { App, PluginSettingTab, Setting } from "obsidian";
import type DeepSeekPlugin from "./main";
import { BaiduAuthModal } from "./BaiduAuthModal";

export class DeepSeekSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: DeepSeekPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("DeepSeek Knowledge Graph 设置").setHeading();

    new Setting(containerEl)
      .setName("API key")
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
      .setName("问题索引路径")
      .setDesc("问题图谱索引页存储目录")
      .addText((text) =>
        text
          .setPlaceholder("Knowledge/Questions")
          .setValue(this.plugin.settings.questionsIndexPath)
          .onChange(async (value) => {
            this.plugin.settings.questionsIndexPath = value.trim() || "Knowledge/Questions";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("概念页保存路径")
      .setDesc("概念页存储目录（相对于 Vault 根目录）")
      .addText((text) =>
        text
          .setPlaceholder("Knowledge/Concepts")
          .setValue(this.plugin.settings.conceptsPath)
          .onChange(async (value) => {
            this.plugin.settings.conceptsPath = value.trim() || "Knowledge/Concepts";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自动打开 Graph view")
      .setDesc("生成笔记后自动打开图谱视图")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoOpenGraph)
          .onChange(async (value) => {
            this.plugin.settings.autoOpenGraph = value;
            await this.plugin.saveSettings();
          })
      );

    // ── 百度云同步 ──────────────────────────────────────────
    new Setting(containerEl).setName("百度网盘同步").setHeading();

    new Setting(containerEl)
      .setName("启用百度云同步")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.baiduSync.enabled).onChange(async (v) => {
          this.plugin.settings.baiduSync.enabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.baiduSync.enabled) {
      new Setting(containerEl)
        .setName("App ID")
        .setDesc("百度开放平台应用的 App Key")
        .addText((text) =>
          text
            .setPlaceholder("your-app-id")
            .setValue(this.plugin.settings.baiduSync.appId)
            .onChange(async (v) => {
              this.plugin.settings.baiduSync.appId = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("App secret")
        .setDesc("百度开放平台应用的 Secret Key")
        .addText((text) => {
          text
            .setPlaceholder("your-app-secret")
            .setValue(this.plugin.settings.baiduSync.appSecret)
            .onChange((v) => {
              this.plugin.settings.baiduSync.appSecret = v.trim();
              void this.plugin.saveSettings();
            });
          text.inputEl.type = "password";
          return text;
        });

      const tokenStatus = this.plugin.settings.baiduSync.accessToken
        ? `已授权（过期时间：${this.plugin.settings.baiduSync.tokenExpiresAt?.slice(0, 10) ?? "未知"}）`
        : "未授权";

      new Setting(containerEl)
        .setName("授权状态")
        .setDesc(tokenStatus)
        .addButton((btn) =>
          btn.setButtonText("重新授权").onClick(() => {
            new BaiduAuthModal(
              this.app,
              this.plugin.settings.baiduSync,
              (accessToken, refreshToken, expiresAt) => {
                this.plugin.settings.baiduSync.accessToken = accessToken;
                this.plugin.settings.baiduSync.refreshToken = refreshToken;
                this.plugin.settings.baiduSync.tokenExpiresAt = expiresAt;
                void this.plugin.saveSettings().then(() => this.display());
              }
            ).open();
          })
        );

      new Setting(containerEl)
        .setName("远端备份路径")
        .setDesc("百度网盘中的备份根目录")
        .addText((text) =>
          text
            .setPlaceholder("/apps/istart-note-ai")
            .setValue(this.plugin.settings.baiduSync.remotePath)
            .onChange(async (v) => {
              this.plugin.settings.baiduSync.remotePath = v.trim() || "/apps/istart-note-ai";
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("自动备份")
        .setDesc("每次生成笔记后自动备份到百度云")
        .addToggle((t) =>
          t.setValue(this.plugin.settings.baiduSync.autoBackup).onChange(async (v) => {
            this.plugin.settings.baiduSync.autoBackup = v;
            await this.plugin.saveSettings();
          })
        );

      new Setting(containerEl)
        .setName("忽略规则")
        .setDesc("正则表达式，匹配的文件路径将被跳过")
        .addText((text) =>
          text
            .setPlaceholder("node_modules|.git")
            .setValue(this.plugin.settings.baiduSync.ignorePattern)
            .onChange(async (v) => {
              this.plugin.settings.baiduSync.ignorePattern = v.trim();
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("单文件大小限制（MB）")
        .addText((text) =>
          text
            .setPlaceholder("100")
            .setValue(String(this.plugin.settings.baiduSync.fileSizeLimitMB))
            .onChange(async (v) => {
              const n = parseInt(v);
              if (!isNaN(n) && n > 0) {
                this.plugin.settings.baiduSync.fileSizeLimitMB = n;
                await this.plugin.saveSettings();
              }
            })
        );

      // 配置同步
      new Setting(containerEl).setName("配置同步").setHeading();
      containerEl.createEl("p", {
        text: "将路径、模型等偏好设置同步到百度云，在多台设备间共享（不含 API Key 和 Token 等凭证）。",
        cls: "istart-settings-config-hint",
      });

      new Setting(containerEl)
        .setName("推送配置到百度云")
        .setDesc("将当前设置上传，其他设备可拉取同步")
        .addButton((btn) =>
          btn.setButtonText("推送").onClick(async () => {
            await this.plugin.pushConfig();
          })
        );

      new Setting(containerEl)
        .setName("从百度云拉取配置")
        .setDesc("拉取最新配置并应用（不覆盖凭证）")
        .addButton((btn) =>
          btn.setButtonText("拉取").onClick(async () => {
            await this.plugin.pullConfig();
            this.display();
          })
        );
    }
  }
}
