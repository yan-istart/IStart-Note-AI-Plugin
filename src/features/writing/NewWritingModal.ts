import { App, Setting, Notice } from "obsidian";
import { WritingGenre } from "./types";
import { ActionModal } from "../../ui/ActionModal";

const GENRE_LABEL: Record<WritingGenre, string> = {
  novel: "网文小说",
  paper: "论文",
  article: "通用长文",
};

export interface NewWritingInput {
  genre: WritingGenre;
  title: string;
  premise: string;
}

/**
 * 新建作品弹窗 — 选择体裁,输入标题与一句话简介。
 */
export class NewWritingModal extends ActionModal {
  private genre: WritingGenre = "novel";
  private title = "";
  private premise = "";

  constructor(
    app: App,
    private onSubmit: (input: NewWritingInput) => void
  ) {
    super(app);
    this.titleEl.setText("新建写作项目");
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;

    contentEl.createEl("p", {
      text: "AI 会生成：作品首页、大纲（含每章梗概）、章节文件，小说还会生成角色卡与世界观设定。",
      cls: "istart-diagram-hint",
    });

    new Setting(contentEl)
      .setName("体裁")
      .addDropdown((drop) =>
        drop
          .addOption("novel", GENRE_LABEL.novel)
          .addOption("paper", GENRE_LABEL.paper)
          .addOption("article", GENRE_LABEL.article)
          .setValue(this.genre)
          .onChange((v) => { this.genre = v as WritingGenre; })
      );

    new Setting(contentEl)
      .setName("作品标题")
      .setDesc("留空可由 AI 根据简介拟定")
      .addText((text) =>
        text.setPlaceholder("如：雾港秘闻").onChange((v) => { this.title = v.trim(); })
      );

    const premiseArea = contentEl.createEl("textarea", {
      attr: {
        placeholder: "一句话简介，如：\n一个失忆的验尸官在一座常年起雾的港口城市，靠触碰尸体回溯记忆，逐渐发现自己也是十年前悬案的一部分。",
        rows: "5",
      },
      cls: "istart-question-textarea",
    });
    premiseArea.addEventListener("input", () => { this.premise = premiseArea.value; });

    new Setting(this.actionsEl)
      .addButton((btn) =>
        btn.setButtonText("生成项目").setCta().onClick(() => {
          if (!this.premise.trim()) {
            new Notice("请填写一句话简介");
            return;
          }
          this.close();
          this.onSubmit({ genre: this.genre, title: this.title, premise: this.premise.trim() });
        })
      )
      .addButton((btn) => btn.setButtonText("取消").onClick(() => this.close()));
  }

  onClose() {
    super.onClose();
  }
}
