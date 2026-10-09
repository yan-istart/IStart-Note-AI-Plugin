import { App, Modal, setIcon } from "obsidian";

export interface PanelAction {
  id: string;
  icon: string;
  label: string;
  description?: string;
  callback: () => void;
}

export interface PanelGroup {
  title: string;
  actions: PanelAction[];
}

/**
 * 统一命令面板 — 根据上下文动态展示可用操作
 */
export class CommandPanelModal extends Modal {
  private groups: PanelGroup[];

  constructor(app: App, groups: PanelGroup[]) {
    super(app);
    this.groups = groups;
    this.titleEl.setText("IStart-Note-AI");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("istart-command-panel");

    let shortcutIndex = 1;

    for (const group of this.groups) {
      if (group.actions.length === 0) continue;

      const groupEl = contentEl.createDiv({ cls: "istart-panel-group" });
      groupEl.createEl("div", { text: group.title, cls: "istart-panel-group-title" });

      for (const action of group.actions) {
        const row = groupEl.createDiv({ cls: "istart-panel-action" });

        const iconEl = row.createSpan({ cls: "istart-panel-action-icon" });
        setIcon(iconEl, action.icon);

        const textEl = row.createDiv({ cls: "istart-panel-action-text" });
        textEl.createEl("span", { text: action.label, cls: "istart-panel-action-label" });
        if (action.description) {
          textEl.createEl("span", { text: action.description, cls: "istart-panel-action-desc" });
        }

        if (shortcutIndex <= 9) {
          row.createSpan({ text: `${shortcutIndex}`, cls: "istart-panel-action-key" });
        }

        row.addEventListener("click", () => {
          this.close();
          action.callback();
        });

        shortcutIndex++;
      }
    }

    // 键盘快捷键支持
    const handler = (e: KeyboardEvent) => {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        const allActions = this.groups.flatMap((g) => g.actions);
        const action = allActions[num - 1];
        if (action) {
          this.close();
          action.callback();
        }
      }
      if (e.key === "Escape") {
        this.close();
      }
    };
    document.addEventListener("keydown", handler);
    this.onClose = () => {
      document.removeEventListener("keydown", handler);
      contentEl.empty();
    };
  }
}
