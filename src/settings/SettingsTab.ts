import type { SettingDefinitionItem } from "obsidian";
import { App, Notice, PluginSettingTab, Setting, requireApiVersion } from "obsidian";
import type DeepSeekPlugin from "../main";
import type { DeepSeekSettings } from "../types";
import type { SkillDefinition } from "../core/skills/types";
import { BaiduAuthModal } from "../features/sync/BaiduAuthModal";
import { renderPublishingConnection } from "../features/publishing/PublishingSettings";
import { publishingFolder } from "../core/publishing/types";

type SettingsSection = "knowledge" | "writing" | "skill" | "annotation" | "interface" | "sync" | "publishing" | "auxiliary";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; aliases: string[] }[] = [
  { id: "publishing", label: "内容分发", aliases: ["远程服务地址", "本地安装并启动", "分发目录", "Wechatsync", "图文分发"] },
  { id: "knowledge", label: "知识", aliases: ["知识路径", "Q&A 笔记目录", "问题索引目录", "概念页目录", "知识索引", "索引状态", "生成笔记后自动打开图谱"] },
  { id: "writing", label: "写作", aliases: ["写作路径", "作品目录", "续写与插写", "写作上下文范围", "上下文长度", "默认续写字数", "默认插写字数"] },
  { id: "skill", label: "Skill", aliases: ["写作 Skill", "启用自动附带", "仅在写作场景注入", "Skill 根目录", "最大注入字符", "已发现 Skill"] },
  { id: "annotation", label: "批注", aliases: ["侧边栏批注", "默认批注形式", "移动端跳转后收起侧栏", "打开批注侧边栏", "使用方式"] },
  { id: "interface", label: "界面", aliases: ["悬浮工具栏", "启用悬浮工具栏", "选中文字时显示", "光标空闲时显示入口", "移动端启用"] },
  { id: "sync", label: "数据同步", aliases: ["IStart 数据同步", "启用 IStart 数据同步", "存储服务", "同步方式", "自动 Git 同步", "手动 Git 整库同步", "自动备份", "备份插件本身", "忽略规则", "单文件大小限制（MB）", "跨设备配置同步", "启动时自动拉取配置", "百度网盘配置", "App ID", "App Secret", "授权状态", "远端路径"] },
  { id: "auxiliary", label: "辅助", aliases: ["AI 服务", "API Key", "Base URL", "模型", "输出风格", "Agent 对话", "打开 AI 助手侧边栏", "流式输出", "每轮工具步数上限", "上下文资料预算", "共享会话历史", "隐私与诊断"] },
];

export class DeepSeekSettingsTab extends PluginSettingTab {
  private publishingUnsubscribe: (() => void) | null = null;
  private activeSection: SettingsSection = "auxiliary"; // start with AI setup
  private skillListGeneration = 0;

  constructor(app: App, private plugin: DeepSeekPlugin) {
    super(app, plugin);
  }

  /** Index legacy sections without rendering controls or scanning skills during registration. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return SETTINGS_SECTIONS.map(section => ({
      type: "page",
      name: section.label,
      items: [{
        name: `${section.label}设置`,
        aliases: section.aliases,
        render: setting => {
          this.activeSection = section.id;
          this.containerEl.addClass("istart-settings-root");
          setting.settingEl.empty();
          setting.settingEl.removeClass("setting-item");
          this.renderSection(setting.settingEl);
        },
      }],
    }));
  }

  private refresh(): void {
    // On 1.13+, display() is bypassed and update() preserves the current sub-page.
    if (requireApiVersion("1.13.0")) this.update();
    else this.display();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("istart-settings-root");

    // ── Header ───────────────────────────────────────────────
    containerEl.createEl("p", {
      text: "知识沉淀 · 创作写作 · 同步辅助",
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
    for (const sec of SETTINGS_SECTIONS) {
      const item = container.createDiv({
        cls: `istart-settings-nav-item${this.activeSection === sec.id ? " is-active" : ""}`,
      });
      item.setText(sec.label);
      item.addEventListener("click", () => {
        this.activeSection = sec.id;
        this.refresh();
      });
    }
  }

  private renderSection(container: HTMLElement): void {
    switch (this.activeSection) {
      case "publishing":
        this.renderPublishing(container);
        break;
      case "knowledge":
        this.renderKnowledge(container);
        break;
      case "writing":
        this.renderWriting(container);
        break;
      case "skill":
        this.renderSkill(container);
        break;
      case "annotation":
        this.renderAnnotation(container);
        break;
      case "interface":
        this.renderInterface(container);
        break;
      case "sync":
        this.renderSync(container);
        break;
      case "auxiliary":
        this.renderAuxiliary(container);
        break;
    }
  }

  private renderPublishing(el: HTMLElement): void {
    new Setting(el).setName("分发目录").setDesc("保存稿件和图片快照、逐次发送记录，首次保存时创建。")
      .addText(input => input.setValue(this.plugin.settings.publishing.folder)
        .setDisabled(this.plugin.publishing.busy || this.plugin.publishing.records.some(record => record.job.state === "sending"))
        .onChange(async value => {
        try {
          this.plugin.settings.publishing.folder = publishingFolder(value);
          this.plugin.publishing.snapshot = null;
          await this.plugin.saveSettings(); this.plugin.knowledgeIndex?.rebuild();
        } catch { /* Keep the last valid folder while typing. */ }
      }));
    renderPublishingConnection(el, this.plugin, () => this.refresh());
    const status = el.createEl("p", { text: this.plugin.publishing.message, attr: { role: "status" } });
    this.publishingUnsubscribe?.();
    this.publishingUnsubscribe = this.plugin.publishing.onChange(() => { if (status.isConnected) status.setText(this.plugin.publishing.message); });
  }

  hide(): void { this.publishingUnsubscribe?.(); this.publishingUnsubscribe = null; }

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
          new Notice(`索引已重建：${this.plugin.knowledgeIndex.size} 篇`);
          this.refresh();
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
  //  写作
  // ══════════════════════════════════════════════════════════════

  private renderWriting(el: HTMLElement): void {
    new Setting(el).setName("写作路径").setHeading();

    new Setting(el)
      .setName("作品目录")
      .setDesc("网文小说存于 Writing/Novels,论文存于 Writing/Papers")
      .addText((t) =>
        t.setPlaceholder("Writing").setValue(this.plugin.settings.writingPath).onChange(async (v) => {
          this.plugin.settings.writingPath = v.trim() || "Writing";
          await this.plugin.saveSettings();
        })
      );

    new Setting(el).setName("续写与插写").setHeading();

    new Setting(el).setName("写作上下文范围").setDesc("默认保证带入当前整章；作品章节再带入完整大纲、角色与设定")
      .addDropdown((dropdown) => dropdown.addOption("full", "完整当前文档＋大纲和设定")
        .addOption("nearby", "光标附近")
        .setValue(this.plugin.settings.writingContextScope).onChange(async (value) => {
          this.plugin.settings.writingContextScope = value as "full" | "nearby";
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("上下文长度")
      .setDesc("仅用于「光标附近」模式；续写与插写分别提供这些字符的前文和后文")
      .addText((t) =>
        t.setPlaceholder("2000").setValue(String(this.plugin.settings.continueContextChars)).onChange(async (v) => {
          const n = parseInt(v);
          if (!isNaN(n) && n > 0) { this.plugin.settings.continueContextChars = n; await this.plugin.saveSettings(); }
        })
      );

    new Setting(el)
      .setName("默认续写字数")
      .setDesc("生成量的近似目标，1–10000 字；实际字数显示在预览中")
      .addText((t) =>
        t.setPlaceholder("800").setValue(String(this.plugin.settings.continueTargetWords)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0 && n <= 10000) { this.plugin.settings.continueTargetWords = n; await this.plugin.saveSettings(); }
        })
      );

    new Setting(el)
      .setName("默认插写字数")
      .setDesc("补充内容的近似目标，1–10000 字；独立于续写，实际字数显示在预览中")
      .addText((t) =>
        t.setPlaceholder("200").setValue(String(this.plugin.settings.insertTargetWords)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0 && n <= 10000) { this.plugin.settings.insertTargetWords = n; await this.plugin.saveSettings(); }
        })
      );
  }

  // ══════════════════════════════════════════════════════════════
  //  写作 Skill
  // ══════════════════════════════════════════════════════════════

  private renderSkill(el: HTMLElement): void {
    new Setting(el).setName("写作 Skill").setHeading();
    el.createEl("p", {
      text: "读取标准 Agent Skills：<skill-id>/SKILL.md。公共写作技巧建议标为 global，体裁规范标为 genre，单个作品的规则标为 project。Codex 与 OpenCode 可直接从 .agents/skills 发现同一份文件。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
    });

    new Setting(el)
      .setName("启用自动附带")
      .setDesc("开启后，符合条件的 Skill 会注入所有写作类 AI 请求。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.skills.enabled)
        .onChange(async (value) => {
          this.plugin.settings.skills.enabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("仅在写作场景注入")
      .setDesc("关闭后，标记为 apply: all 的全局 Skill 也会进入知识问答等其他 AI 请求。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.skills.writingOnly)
        .onChange(async (value) => {
          this.plugin.settings.skills.writingOnly = value;
          await this.plugin.saveSettings();
        }));

    let listEl: HTMLElement | null = null;
    let refreshTimer: number | undefined;
    new Setting(el)
      .setName("Skill 根目录")
      .setDesc("每行一个 Vault 相对路径。默认 Skills 与 .agents/skills；不读取 Vault 外路径。")
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.skills.roots.join("\n"));
        text.inputEl.rows = 3;
        text.inputEl.addClass("istart-skill-roots");
        text.onChange(async (value) => {
          this.plugin.settings.skills.roots = value
            .split(/\r?\n/)
            .map((root) => root.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
          this.plugin.skillRegistry.invalidate();
          if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => {
            this.plugin.knowledgeIndex.rebuild();
            void this.plugin.skillRegistry.refresh().then(() => {
              if (listEl) void this.renderSkillList(listEl);
            });
          }, 400);
        });
      });

    new Setting(el)
      .setName("最大注入字符")
      .setDesc("作品级 Skill 优先占用预算，其次是体裁级和通用 Skill。")
      .addText((text) => text
        .setPlaceholder("6000")
        .setValue(String(this.plugin.settings.skills.maxChars))
        .onChange(async (value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          this.plugin.settings.skills.maxChars = Math.min(20000, Math.round(parsed));
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("已发现 Skill")
      .setDesc("关闭某个 Skill 只会影响插件自动注入，不影响 Codex / OpenCode 的发现。")
      .addButton((button) => button.setButtonText("重新扫描").onClick(async () => {
        await this.plugin.skillRegistry.refresh();
        this.refresh();
      }));

    listEl = el.createDiv({ cls: "istart-skill-list" });
    void this.renderSkillList(listEl);
  }

  private async renderSkillList(container: HTMLElement): Promise<void> {
    const generation = ++this.skillListGeneration;
    container.empty();
    container.createEl("p", {
      text: "扫描中…",
      attr: { style: "color: var(--text-muted); font-size: 13px;" },
    });
    const skills = await this.plugin.skillRegistry.ensureLoaded();
    if (generation !== this.skillListGeneration) return;
    container.empty();

    if (skills.length === 0) {
      container.createEl("p", {
        text: "还没有发现 Skill。新建 Skills/writing-craft/SKILL.md，或把 Skill 放到 .agents/skills。",
        attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
      });
      return;
    }

    const disabled = new Set(this.plugin.settings.skills.disabledSkillIds);
    for (const skill of skills) {
      const setting = new Setting(container)
        .setName(skill.name)
        .setDesc(`${this.skillScopeLabel(skill)} · ${skill.description || "无描述"}`)
        .addToggle((toggle) => toggle
          .setValue(!disabled.has(skill.id))
          .onChange(async (value) => {
            const next = new Set(this.plugin.settings.skills.disabledSkillIds);
            if (value) next.delete(skill.id);
            else next.add(skill.id);
            this.plugin.settings.skills.disabledSkillIds = [...next];
            await this.plugin.saveSettings();
          }));
      setting.descEl.createDiv({ text: skill.path, cls: "istart-skill-path" });
    }
  }

  private skillScopeLabel(skill: SkillDefinition): string {
    if (skill.scope === "project") {
      return `作品：${skill.project || skill.projectPath || skill.id}`;
    }
    if (skill.scope === "genre") {
      return `体裁：${skill.genre || "全部"}`;
    }
    return "通用";
  }

  // ══════════════════════════════════════════════════════════════
  //  批注
  // ══════════════════════════════════════════════════════════════

  private renderAnnotation(el: HTMLElement): void {
    new Setting(el).setName("侧边栏批注").setHeading();
    el.createEl("p", {
      text: "批注使用 Obsidian 原生 Markdown：==高亮==、^[行内批注]、[^1]: 脚注批注。即使停用插件，笔记内容和批注仍可正常阅读。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
    });

    new Setting(el)
      .setName("默认批注形式")
      .setDesc("行内批注紧跟在文字后；脚注批注集中到文末。只影响新建批注，已有批注不会改变。")
      .addDropdown((dropdown) => dropdown
        .addOption("inline", "行内批注（推荐，移动端更易读）")
        .addOption("footnote", "脚注批注（文末集中）")
        .setValue(this.plugin.settings.annotationCommentStyle)
        .onChange(async (value) => {
          this.plugin.settings.annotationCommentStyle = value as "inline" | "footnote";
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("移动端跳转后收起侧栏")
      .setDesc("在手机或平板上点击批注并跳转到原文后，自动收起右侧边栏，方便继续阅读。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.annotationCollapseSidebarOnMobile)
        .onChange(async (value) => {
          this.plugin.settings.annotationCollapseSidebarOnMobile = value;
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("打开批注侧边栏")
      .setDesc("查看当前笔记或整个知识库中的高亮与批注。")
      .addButton((button) => button.setButtonText("打开").onClick(() => {
        void this.plugin.activateAnnotationView();
      }));

    new Setting(el).setName("使用方式").setHeading();
    el.createEl("p", {
      text: "在编辑模式选中文字后，运行命令「添加批注」，或在编辑器右键菜单、功能面板中选择。也可以使用「AI 批注」先让 AI 草拟，再修改确认。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
    });
    el.createEl("p", {
      text: "AI 草拟只在你主动点击时发送选中文字和少量上下文到已配置的 AI 服务；普通批注不会联网。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  界面
  // ══════════════════════════════════════════════════════════════

  private renderInterface(el: HTMLElement): void {
    new Setting(el).setName("悬浮工具栏").setHeading();
    el.createEl("p", {
      text: "在编辑器选中文字后显示快捷操作栏，按钮会根据当前选区、文件类型和可用功能自动过滤。末尾「更多」打开完整功能面板。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
    });

    new Setting(el)
      .setName("启用悬浮工具栏")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.floatingToolbar.enabled)
        .onChange(async (value) => {
          this.plugin.settings.floatingToolbar.enabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("选中文字时显示")
      .setDesc("选中文字后短暂停顿再显示，避免拖动选择时闪烁。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.floatingToolbar.showOnSelection)
        .onChange(async (value) => {
          this.plugin.settings.floatingToolbar.showOnSelection = value;
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("光标空闲时显示入口")
      .setDesc("无选区时，在光标旁显示一个小按钮；点击后展开续写、插写、总结等操作。默认关闭。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.floatingToolbar.showAtCursor)
        .onChange(async (value) => {
          this.plugin.settings.floatingToolbar.showAtCursor = value;
          await this.plugin.saveSettings();
        }));

    new Setting(el)
      .setName("移动端启用")
      .setDesc("移动端已有原生选区菜单，默认关闭，避免与选区手柄和键盘工具栏重叠。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.floatingToolbar.mobile)
        .onChange(async (value) => {
          this.plugin.settings.floatingToolbar.mobile = value;
          await this.plugin.saveSettings();
        }));

    el.createEl("p", {
      text: "当前工具栏只覆盖编辑模式；阅读模式的悬浮操作仍使用 Obsidian 原生菜单和插件命令面板。",
      attr: { style: "color: var(--text-muted); font-size: 13px; line-height: 1.5;" },
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

    new Setting(el).setName("Agent 对话").setHeading();
    new Setting(el).setName("打开 AI 助手侧边栏").setDesc("多会话、知识库问答、写作与修改预览")
      .addButton(b => b.setButtonText("打开").onClick(() => this.plugin.openAssistant()));
    new Setting(el).setName("流式输出").setDesc("逐步显示回答。服务不支持浏览器跨域请求时，自动回退为完整回复。")
      .addToggle(t => t.setValue(this.plugin.settings.agent.streaming).onChange(async value => { this.plugin.settings.agent.streaming = value; await this.plugin.saveSettings(); }));
    new Setting(el).setName("每轮工具步数上限").setDesc("2–20 步，默认 8 步。复杂任务可以拆分到后续消息。")
      .addSlider(s => {
        s.setLimits(2, 20, 1).setValue(this.plugin.settings.agent.maxSteps);
        s.sliderEl.title = String(this.plugin.settings.agent.maxSteps);
        return s.onChange(async value => { s.sliderEl.title = String(value); this.plugin.settings.agent.maxSteps = value; await this.plugin.saveSettings(); });
      });
    new Setting(el).setName("上下文资料预算").setDesc("引用笔记、对话历史和工具结果的字符预算，不含工具说明和技能。")
      .addDropdown(d => d.addOption("12000", "精简 · 12,000 字符").addOption("30000", "标准 · 30,000 字符").addOption("60000", "扩展 · 60,000 字符").setValue(String(this.plugin.settings.agent.contextChars)).onChange(async value => { this.plugin.settings.agent.contextChars = Number(value); await this.plugin.saveSettings(); }));
    new Setting(el).setName("共享会话历史").setDesc("默认仅存本机插件目录。启用后将对话内容与引用快照写入 IStart/Agent Sessions/history.json，可由 Vault 同步服务同步；API Key 不写入会话文件。关闭后保留已有共享文件。")
      .addToggle(t => t.setValue(this.plugin.settings.agent.syncHistory).onChange(async value => {
        this.plugin.settings.agent.syncHistory = value;
        await this.plugin.saveSettings();
        if (value) await this.plugin.agent.pushSharedHistory();
      }));

    // ── 隐私与诊断 ───────────────────────────────────────────
    new Setting(el).setName("隐私与诊断").setHeading();
    el.createEl("p", {
      text: "AI 功能会把选中内容和部分上下文发送到所配置的 API 端点。同步功能会把笔记上传到你配置的存储服务；目前支持百度网盘。完整说明见 PRIVACY.md。",
      attr: { style: "color: var(--text-muted); font-size: 13px;" },
    });
  }

  private renderSync(el: HTMLElement): void {
    new Setting(el).setName("IStart 数据同步").setHeading();

    new Setting(el)
      .setName("启用 IStart 数据同步")
      .setDesc("通过配置的存储服务同步笔记与附件，默认关闭。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.baiduSync.enabled).onChange(async (v) => {
          this.plugin.settings.baiduSync.enabled = v;
          await this.plugin.saveSettings();
          this.refresh();
        })
      );

    new Setting(el).setName("存储服务").setDesc("当前支持百度网盘；启用后可在「百度网盘配置」中管理授权信息。");

    if (this.plugin.settings.baiduSync.enabled) this.renderSyncSettings(el);
  }

  private renderSyncSettings(el: HTMLElement): void {
    const cfg = this.plugin.settings.baiduSync;

    new Setting(el).setName("同步方式")
      .setDesc("Git 模式支持提交历史和文本合并；切换不会删除旧备份，所有设备需选择相同方式。")
      .addDropdown((drop) => drop.addOption("git", "Git 版本同步（支持电脑与手机）")
        .addOption("files", "原有文件备份与同步").setValue(cfg.syncEngine).onChange(async (value) => {
          cfg.syncEngine = value as "git" | "files";
          await this.plugin.saveSettings(); this.refresh();
        }));

    if (cfg.syncEngine === "git") {
      new Setting(el).setName("自动 Git 同步")
        .setDesc("默认关闭。开启后，在应用处于前台时每分钟同步，启动时也同步一次。")
        .addToggle((toggle) => toggle.setValue(cfg.autoSync).onChange(async (value) => {
          cfg.autoSync = value; await this.plugin.saveSettings();
        }));
      new Setting(el).setName("手动 Git 整库同步")
        .setDesc("同步整个笔记库的笔记与附件，包括所有子目录。忽略规则、大小限制和配置目录排除仍生效；可查看、恢复整库版本。")
        .addButton((btn) => btn.setButtonText("打开同步").onClick(() => this.plugin.openDataSyncModal()));
    }

    if (cfg.syncEngine === "files") {
      new Setting(el)
        .setName("自动备份")
        .setDesc("原有文件备份偏好，默认关闭")
        .addToggle((t) => t.setValue(cfg.autoBackup).onChange(async (v) => { cfg.autoBackup = v; await this.plugin.saveSettings(); }));

      new Setting(el)
        .setName("备份插件本身")
        .addToggle((t) => t.setValue(cfg.backupPlugin).onChange(async (v) => { cfg.backupPlugin = v; await this.plugin.saveSettings(); }));
    }

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

    this.renderBaiduSyncSettings(el);

    // 配置同步
    new Setting(el).setName("跨设备配置同步").setDesc("不含凭证").setHeading();

    new Setting(el).setName("启动时自动拉取配置")
      .setDesc("默认关闭；自动同步开关始终由本设备控制。")
      .addToggle((toggle) => toggle.setValue(cfg.autoPullConfig).onChange(async (value) => {
        cfg.autoPullConfig = value; await this.plugin.saveSettings();
      }));

    new Setting(el)
      .addButton((btn) => btn.setButtonText("推送配置").onClick(() => void this.plugin.pushConfig()))
      .addButton((btn) => btn.setButtonText("拉取配置").onClick(async () => { await this.plugin.pullConfig(); this.refresh(); }));
  }

  private renderBaiduSyncSettings(el: HTMLElement): void {
    const cfg = this.plugin.settings.baiduSync;
    new Setting(el).setName("百度网盘配置").setDesc("IStart 数据同步的存储服务配置，文件上传到你自己的百度网盘。").setHeading();

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
            void this.plugin.saveSettings().then(() => this.refresh());
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
  }
}
