import { App, Setting } from "obsidian";
import { ActionModal } from "../../ui/ActionModal";
import type { InsertRequest } from "./types";
import { addWritingFields } from "./WritingFields";

export class InsertModal extends ActionModal {
  constructor(
    app: App,
    private defaultWords: number,
    fileName: string,
    private onSubmit: (request: InsertRequest) => void
  ) {
    super(app);
    this.titleEl.setText(`插写：${fileName}`);
  }

  onOpen() {
    super.onOpen();
    this.bodyEl.createEl("p", {
      text: "参考光标前后文，补充连接内容；确认预览后插入原光标处。",
      cls: "istart-assistant-context",
    });
    const readRequest = addWritingFields(this.bodyEl, this.defaultWords, [100, 200, 300],
      "如：补一段时间过渡 / 解释前后观点的关系", ["承上启下", "补充解释", "转场"]);
    new Setting(this.actionsEl)
      .addButton((button) => button.setButtonText("开始插写").setCta().onClick(() => {
        const request = readRequest();
        if (!request) return;
        this.close();
        this.onSubmit(request);
      }))
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
  }
}
