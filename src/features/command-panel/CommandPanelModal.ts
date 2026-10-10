import { App, Platform, setIcon } from "obsidian";
import { ActionModal } from "../../ui/ActionModal";
import { panelIcon } from "../../ui/icons";

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
export class CommandPanelModal extends ActionModal {
  private groups: PanelGroup[];

  constructor(app: App, groups: PanelGroup[], private quickActions: PanelAction[] = []) {
    super(app);
    this.groups = groups;
    this.titleEl.setText("IStart-Note-AI");
  }

  onOpen() {
    super.onOpen();
    const contentEl = this.bodyEl;
    contentEl.addClass("istart-command-panel");
    this.actionsEl.hidden = true;

    if (this.quickActions.length) {
      const grid = contentEl.createDiv({ cls: "istart-quick-grid" });
      for (const action of this.quickActions) {
        const button = grid.createEl("button", { cls: "istart-quick-action", attr: { type: "button", title: action.description ?? action.label } });
        setIcon(button.createSpan({ cls: "istart-quick-icon" }), panelIcon(action.icon));
        button.createSpan({ text: action.label });
        button.addEventListener("click", () => { this.close(); action.callback(); });
      }
    }

    let groupContainer = contentEl;
    if (Platform.isMobile && this.quickActions.length && this.groups.length) {
      const details = contentEl.createEl("details", { cls: "istart-panel-more" });
      details.createEl("summary", { text: "全部功能" });
      groupContainer = details.createDiv();
    }

    let shortcutIndex = 1;

    for (const group of this.groups) {
      if (group.actions.length === 0) continue;

      const groupEl = groupContainer.createDiv({ cls: "istart-panel-group" });
      groupEl.createEl("div", { text: group.title, cls: "istart-panel-group-title" });

      for (const action of group.actions) {
        const row = groupEl.createEl("button", { cls: "istart-panel-action", attr: { type: "button" } });

        const iconEl = row.createSpan({ cls: "istart-panel-action-icon" });
        setIcon(iconEl, panelIcon(action.icon));

        const textEl = row.createDiv({ cls: "istart-panel-action-text" });
        textEl.createEl("span", { text: action.label, cls: "istart-panel-action-label" });
        if (action.description) {
          textEl.createEl("span", { text: action.description, cls: "istart-panel-action-desc" });
        }

        if (!Platform.isMobile && shortcutIndex <= 9) {
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
    const handler = (event: Event) => {
      const e = event as KeyboardEvent;
      const num = parseInt(e.key);
      if (!Platform.isMobile && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey && num >= 1 && num <= 9) {
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
    this.listen(contentEl.ownerDocument, "keydown", handler);
  }
}
