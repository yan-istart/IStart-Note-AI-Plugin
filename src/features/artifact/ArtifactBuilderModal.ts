import { App, Modal, Setting } from "obsidian";
import {
  ArtifactType, ArtifactUsageMode, ArtifactSourceScope, EvidencePolicy,
  ArtifactBuildParams,
  ARTIFACT_TYPE_LABELS, USAGE_MODE_LABELS, SOURCE_SCOPE_LABELS, EVIDENCE_POLICY_LABELS,
} from "../../core/artifact";

/**
 * Five-question builder for creating an execution artifact.
 * Collects: type, target, usage, source scope, evidence policy.
 */
export class ArtifactBuilderModal extends Modal {
  private params: ArtifactBuildParams = {
    artifactType: "checklist",
    target: "",
    usageMode: "template",
    sourceScope: "current-note",
    evidencePolicy: "balanced",
  };

  constructor(
    app: App,
    private contextHint: string,
    private defaultScope: ArtifactSourceScope,
    private onSubmit: (params: ArtifactBuildParams) => void,
    private presetType?: string
  ) {
    super(app);
    this.params.sourceScope = defaultScope;
    if (presetType && presetType in ARTIFACT_TYPE_LABELS) {
      this.params.artifactType = presetType as ArtifactType;
    }
  }

  onOpen() {
    const { contentEl } = this;
    this.titleEl.setText("从知识生成执行资产");

    if (this.contextHint) {
      contentEl.createEl("p", {
        text: this.contextHint,
        attr: { style: "color: var(--text-muted); font-size: 13px; margin-bottom: 12px;" },
      });
    }

    // 1. Type
    new Setting(contentEl)
      .setName("你想生成什么？")
      .addDropdown((d) => {
        for (const [key, label] of Object.entries(ARTIFACT_TYPE_LABELS)) {
          d.addOption(key, label);
        }
        d.setValue(this.params.artifactType);
        d.onChange((v: string) => { this.params.artifactType = v as ArtifactType; });
      });

    // 2. Target
    new Setting(contentEl)
      .setName("用于什么对象或场景？")
      .setDesc("例如：婴儿、发布流程、用户访谈、学习复盘")
      .addText((t) =>
        t.setPlaceholder("输入对象或场景")
          .setValue(this.params.target)
          .onChange((v) => { this.params.target = v.trim(); })
      );

    // 3. Usage mode
    new Setting(contentEl)
      .setName("使用方式")
      .addDropdown((d) => {
        for (const [key, label] of Object.entries(USAGE_MODE_LABELS)) {
          d.addOption(key, label);
        }
        d.setValue(this.params.usageMode);
        d.onChange((v: string) => { this.params.usageMode = v as ArtifactUsageMode; });
      });

    // 4. Source scope
    new Setting(contentEl)
      .setName("来源范围")
      .addDropdown((d) => {
        for (const [key, label] of Object.entries(SOURCE_SCOPE_LABELS)) {
          d.addOption(key, label);
        }
        d.setValue(this.params.sourceScope);
        d.onChange((v: string) => { this.params.sourceScope = v as ArtifactSourceScope; });
      });

    // 5. Evidence policy
    new Setting(contentEl)
      .setName("依据要求")
      .addDropdown((d) => {
        for (const [key, label] of Object.entries(EVIDENCE_POLICY_LABELS)) {
          d.addOption(key, label);
        }
        d.setValue(this.params.evidencePolicy);
        d.onChange((v: string) => { this.params.evidencePolicy = v as EvidencePolicy; });
      });

    // Optional instruction
    const textArea = contentEl.createEl("textarea", {
      attr: { placeholder: "可选：补充说明或具体要求...", rows: "2", style: "width: 100%; margin: 8px 0;" },
    });
    textArea.addEventListener("input", () => {
      this.params.instruction = textArea.value.trim() || undefined;
    });

    // Actions
    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("生成预览").setCta().onClick(() => {
          this.close();
          this.onSubmit(this.params);
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}
