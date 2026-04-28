import { App, Modal, Notice, Setting } from "obsidian";
import { BaiduPanClient } from "./BaiduPanClient";
import { BaiduSyncConfig } from "./types";

export class BaiduAuthModal extends Modal {
  private code = "";

  constructor(
    app: App,
    private config: BaiduSyncConfig,
    private onSuccess: (accessToken: string, refreshToken: string, expiresAt: string) => void
  ) {
    super(app);
    this.titleEl.setText("百度网盘授权");
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl("p", {
      text: "点击下方按钮打开百度授权页面，授权后将页面中的授权码粘贴到输入框。",
      attr: { style: "color: var(--text-muted); margin-bottom: 12px;" },
    });

    new Setting(contentEl)
      .setName("打开授权页面")
      .setDesc("在浏览器中完成授权，获取授权码")
      .addButton((btn) =>
        btn.setButtonText("打开授权页").onClick(() => {
          const url = BaiduPanClient.buildAuthUrl(this.config.appId);
          window.open(url);
        })
      );

    const codeInput = contentEl.createEl("input", {
      type: "text",
      attr: {
        placeholder: "粘贴授权码...",
        style: "width: 100%; padding: 8px; margin: 8px 0; font-size: 14px;",
      },
    });
    codeInput.addEventListener("input", () => (this.code = codeInput.value.trim()));

    new Setting(contentEl)
      .addButton((btn) =>
        btn.setButtonText("确认授权").setCta().onClick(() => this.submit())
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  private async submit() {
    if (!this.code) {
      new Notice("请输入授权码");
      return;
    }
    if (!this.config.appId || !this.config.appSecret) {
      new Notice("请先在设置中填写 App ID 和 App Secret");
      return;
    }

    const notice = new Notice("⏳ 正在获取 Token...", 0);
    const client = new BaiduPanClient(this.config);
    const result = await client.exchangeToken(this.code);
    notice.hide();

    if (!result) {
      new Notice("❌ 授权失败，请检查授权码是否正确");
      return;
    }

    const expiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
    this.close();
    this.onSuccess(result.accessToken, result.refreshToken, expiresAt);
    new Notice("✅ 百度网盘授权成功");
  }

  onClose() {
    this.contentEl.empty();
  }
}
