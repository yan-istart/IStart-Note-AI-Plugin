import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DeepSeekPlugin from "../main";
import type { DeepSeekSettings } from "../types";
import { BaiduAuthModal } from "../features/sync/BaiduAuthModal";

type SettingsSection = "knowledge" | "execution" | "auxiliary";

export class DeepSeekSettingsTab extends PluginSettingTab {
  private activeSection: SettingsSection = "auxiliary"; // start with AI setup

  constructor(app: App, private plugin: DeepSeekPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("istart-settings-root");

    // ── Header ───────────────────────────────────────────────
    containerEl.createEl("h2", { text: "IStart-Note-AI" });
    containerEl.createEl("p", {
      text: "知识沉淀 · 执行计划 · 同步辅助",
      attr: { style: "color: var(--text-muted); margin-top: -8px; margin-bottom: 16px;" },
    });

    // ── Layout ───────────────────────────────────────────────
    const layout = containerEl.createDiv({ cls: "istart-settings-layout" });
    const sidebar = layout.createDiv({ cls: "istart-settings-sidebar" });
    const content = layout.createDiv({ cls: "istart-settings-content" });

    this.renderNav(sidebar);
    this.renderSection(content);
  }

  private renderNav(container: HTMLElement): void {
    const sections: { id: SettingsSection; label: string; icon: string }[] = [
      { id: "knowledge", label: "知识", icon: "📚" },
      { id: "execution", label: "执行", icon: "⚡" },
      { id: "auxiliary", label: "辅助", icon: "🔧" },
    ];

    for (const sec of sections) {
      const item = container.createDiv({
        cls: `istart-settings-nav-item${this.activeSection === sec.id ? " is-active" : ""}`,
      });
      item.setText(`${sec.icon} ${sec.label}`);
      item.addEventListener("click", () => {
        this.activeSection = sec.id;
        this.display();
      });
    }
  }

  private renderSection(container: HTMLElement): void {
    switch (this.activeSection) {
      case "knowledge":
        this.renderKnowledge(container);
        break;
      case "execution":
        this.renderExecution(container);
        break;
      case "auxiliary":
        this.renderAuxiliary(container);
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  知识
  // ══════════════════════════════════════════════════════════════

  private renderKnowledge(el: HTMLElement): void {
    new Setting(el).setName("知识路径").setHeading();

    new Setting(el)
      .setName("Q&A 笔记目录")
      .addText((t) =>
        t.setPlaceholder("Knowledge/Q&A").setValue(this.plugin.settings.savePath).onChange(async (v) => {
          this.plugin.settings.savePath = v.trim() || "Knowledge/Q&A";
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("问题索引目录")
      .addText((t) =>
        t.setPlaceholder("Knowledge/Questions").setValue(this.plugin.settings.questionsIndexPath).onChange(async (v) => {
          this.plugin.settings.questionsIndexPath = v.trim() || "Knowledge/Questions";
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("概念页目录")
      .addText((t) =>
        t.setPlaceholder("Knowledge/Concepts").setValue(this.plugin.settings.conceptsPath).onChange(async (v) => {
          this.plugin.settings.conceptsPath = v.trim() || "Knowledge/Concepts";
          await this.plugin.saveSettings();
        })
      );

    // ── 知识索引 ──────────────────────────────────────────────
    new Setting(el).setName("知识索引").setHeading();

    const indexSize = this.plugin.knowledgeIndex?.size ?? 0;
    new Setting(el)
      .setName("索引状态")
      .setDesc(`已索引 ${indexSize} 篇笔记`)
      .addButton((btn) =>
        btn.setButtonText("重建索引").onClick(() => {
          this.plugin.knowledgeIndex.rebuild();
          new Notice(`✅ 索引已重建：${this.plugin.knowledgeIndex.size} 篇`);
          this.display();
        })
      );

    new Setting(el)
      .setName("生成笔记后自动打开图谱")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoOpenGraph).onChange(async (v) => {
          this.plugin.settings.autoOpenGraph = v;
          await this.plugin.saveSettings();
        })
      );
  }

  // ══════════════════════════════════════════════════════════════
  //  执行
  // ══════════════════════════════════════════════════════════════

  private renderExecution(el: HTMLElement): void {
    new Setting(el).setName("执行计划").setHeading();

    el.createEl("p", {
      text: "执行模块当前为实验阶段。所有 AI 生成的写入操作都会先生成计划，需要你确认后再执行。回滚功能尚未实现。",
      attr: { style: "color: var(--text-muted); font-size: 13px; margin-bottom: 12px;" },
    });

    new Setting(el)
      .setName("执行日志目录")
      .setDesc("每次执行计划后自动生成日志")
      .addText((t) =>
        t.setPlaceholder("Knowledge/_Executions").setValue("Knowledge/_Executions").setDisabled(true)
      );

    new Setting(el).setName("定时任务").setHeading();
    el.createEl("p", {
      text: "定时任务即将推出（v2.1）。支持每日知识债务扫描、自动百度备份、每周问题图谱重建。",
      attr: { style: "color: var(--text-muted); font-size: 13px;" },
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  辅助
  // ══════════════════════════════════════════════════════════════

  private renderAuxiliary(el: HTMLElement): void {
    // ── AI 服务 ───────────────────────────────────────────────
    new Setting(el).setName("AI 服务").setHeading();

    new Setting(el)
      .setName("API Key")
      .setDesc("DeepSeek 或其他 OpenAI 兼容服务的密钥")
      .addText((t) => {
        t.setPlaceholder("sk-...")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
        t.inputEl.type = "password";
        return t;
      });

    new Setting(el)
      .setName("Base URL")
      .setDesc("Chat completions 端点根地址")
      .addText((t) =>
        t.setPlaceholder("https://api.deepseek.com").setValue(this.plugin.settings.baseUrl).onChange(async (v) => {
          this.plugin.settings.baseUrl = v.trim() || "https://api.deepseek.com";
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("模型")
      .addDropdown((d) =>
        d.addOption("deepseek-v4-flash", "deepseek-v4-flash（快速）")
          .addOption("deepseek-v4-pro", "deepseek-v4-pro（深度推理）")
          .setValue(this.plugin.settings.model)
          .onChange(async (v: string) => {
            this.plugin.settings.model = v as "deepseek-v4-flash" | "deepseek-v4-pro";
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName("输出风格")
      .addDropdown((d) =>
        d.addOption("knowledge-base", "知识库（推荐）")
          .addOption("technical", "技术文档")
          .addOption("minimal", "极简")
          .addOption("product", "产品设计")
          .addOption("academic", "学术")
          .addOption("story", "世界观/叙事")
          .addOption("dashboard", "卡片化")
          .setValue(this.plugin.settings.outputStyle)
          .onChange(async (v: string) => {
            this.plugin.settings.outputStyle = v as DeepSeekSettings["outputStyle"];
            await this.plugin.saveSettings();
          })
      );

    // ── 百度网盘同步 ──────────────────────────────────────────
    new Setting(el).setName("百度网盘同步").setHeading();

    new Setting(el)
      .setName("启用百度云同步")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.baiduSync.enabled).onChange(async (v) => {
          this.plugin.settings.baiduSync.enabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    if (this.plugin.settings.baiduSync.enabled) {
      this.renderBaiduSyncSettings(el);
    }

    // ── 隐私与诊断 ───────────────────────────────────────────
    new Setting(el).setName("隐私与诊断").setHeading();
    el.createEl("p", {
      text: "AI 功能会把选中内容和部分上下文发送到所配置的 API 端点。同步功能会把笔记上传到你自己的百度网盘。完整说明见 PRIVACY.md。",
      attr: { style: "color: var(--text-muted); font-size: 13px;" },
    });
  }

  private renderBaiduSyncSettings(el: HTMLElement): void {
    const cfg = this.plugin.settings.baiduSync;

    new Setting(el)
      .setName("App ID")
      .addText((t) =>
        t.setPlaceholder("your-app-id").setValue(cfg.appId).onChange(async (v) => {
          cfg.appId = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("App Secret")
      .addText((t) => {
        t.setPlaceholder("your-app-secret").setValue(cfg.appSecret).onChange((v) => {
          cfg.appSecret = v.trim();
          void this.plugin.saveSettings();
        });
        t.inputEl.type = "password";
        return t;
      });

    const tokenStatus = cfg.accessToken
      ? `已授权（过期：${cfg.tokenExpiresAt?.slice(0, 10) ?? "未知"}）`
      : "未授权";

    new Setting(el)
      .setName("授权状态")
      .setDesc(tokenStatus)
      .addButton((btn) =>
        btn.setButtonText("授权").onClick(() => {
          new BaiduAuthModal(this.app, cfg, (accessToken, refreshToken, expiresAt) => {
            cfg.accessToken = accessToken;
            cfg.refreshToken = refreshToken;
            cfg.tokenExpiresAt = expiresAt;
            void this.plugin.saveSettings().then(() => this.display());
          }).open();
        })
      );

    new Setting(el)
      .setName("远端路径")
      .addText((t) =>
        t.setPlaceholder("/apps/istart-note-ai").setValue(cfg.remotePath).onChange(async (v) => {
          cfg.remotePath = v.trim() || "/apps/istart-note-ai";
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("自动备份")
      .setDesc("生成笔记后自动备份")
      .addToggle((t) => t.setValue(cfg.autoBackup).onChange(async (v) => { cfg.autoBackup = v; await this.plugin.saveSettings(); }));

    new Setting(el)
      .setName("备份插件本身")
      .addToggle((t) => t.setValue(cfg.backupPlugin).onChange(async (v) => { cfg.backupPlugin = v; await this.plugin.saveSettings(); }));

    new Setting(el)
      .setName("忽略规则")
      .setDesc("正则表达式")
      .addText((t) =>
        t.setPlaceholder("node_modules|.git").setValue(cfg.ignorePattern).onChange(async (v) => {
          cfg.ignorePattern = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(el)
      .setName("单文件大小限制（MB）")
      .addText((t) =>
        t.setPlaceholder("100").setValue(String(cfg.fileSizeLimitMB)).onChange(async (v) => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) { cfg.fileSizeLimitMB = n; await this.plugin.saveSettings(); }
        })
      );

    // 配置同步
    new Setting(el).setName("跨设备配置同步").setDesc("不含凭证").setHeading();

    new Setting(el)
      .addButton((btn) => btn.setButtonText("推送配置").onClick(() => void this.plugin.pushConfig()))
      .addButton((btn) => btn.setButtonText("拉取配置").onClick(async () => { await this.plugin.pullConfig(); this.display(); }));
  }
}
