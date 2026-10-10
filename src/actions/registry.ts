import { TFile } from "obsidian";
import { frontmatterOf, fmString } from "../util/frontmatter";
import type DeepSeekPlugin from "../main";
import { ActionDef, ActionContext, DOMAIN_TITLES, DOMAIN_ORDER } from "./types";
import { CommandPanelModal } from "../features/command-panel/CommandPanelModal";
import type { PanelGroup } from "../features/command-panel/CommandPanelModal";
import { captureEditorTarget } from "../editor/EditorTarget";

/**
 * 注册所有 actions 到插件的各个入口
 */
export function registerAllActions(plugin: DeepSeekPlugin, actions: ActionDef[]) {
  // 1. 为每个 action 注册命令
  for (const action of actions) {
    if (action.showIn.includes("editor-menu")) {
      plugin.addCommand({
        id: action.id,
        name: action.label,
        icon: action.icon,
        editorCheckCallback: (checking) => {
          const ctx = buildContext(plugin, null);
          if (!evaluateWhen(action.when, ctx)) return false;
          if (!checking) action.run(ctx);
          return true;
        },
      });
    } else {
      plugin.addCommand({
        id: action.id,
        name: action.label,
        icon: action.icon,
        checkCallback: (checking) => {
          const ctx = buildContext(plugin, null);
          if (!evaluateWhen(action.when, ctx)) return false;
          if (!checking) action.run(ctx);
          return true;
        },
      });
    }
  }

  // 2. editor-menu（右键）
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      const ctx = buildContext(plugin, null);
      ctx.editor = editor;
      ctx.selection = editor.getSelection().trim();

      const visible = actions.filter(
        (a) => a.showIn.includes("editor-menu") && evaluateWhen(a.when, ctx)
      );

      for (const action of visible) {
        menu.addItem((item) => {
          item
            .setTitle(`IStart-Note-AI: ${action.label}`)
            .setIcon(action.icon)
            .onClick(() => action.run(ctx));
        });
      }
    })
  );

  // 3. file-menu（文件列表右键）
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;

      const ctx = buildContext(plugin, file);

      const visible = actions.filter(
        (a) => a.showIn.includes("file-menu") && evaluateWhen(a.when, ctx)
      );

      for (const action of visible) {
        menu.addItem((item) => {
          item
            .setTitle(`IStart-Note-AI: ${action.label}`)
            .setIcon(action.icon)
            .onClick(() => action.run(ctx));
        });
      }
    })
  );

  // 4. 面板命令 + ribbon
  plugin.addCommand({
    id: "open-panel",
    name: "打开功能面板",
    icon: "istart-assistant",
    callback: () => openPanel(plugin, actions),
  });

  plugin.addRibbonIcon("istart-assistant", "IStart-Note-AI", () => {
    openPanel(plugin, actions);
  });
}

function openPanel(plugin: DeepSeekPlugin, actions: ActionDef[]) {
  const ctx = buildContext(plugin, null);
  const target = captureEditorTarget(plugin.app);
  const quickIds = ctx.selection
    ? ["polish-writing", "expand-selection", "explain-selection", "ai-assistant"]
    : ctx.fileType === "chapter"
    ? ["continue-writing", "generate-next-chapter", "continue-writing-settings", "ai-assistant"]
    : ["continue-writing", "summarize-note", "ai-assistant"];
  const quickActions = quickIds.map((id) => actions.find((action) => action.id === id))
    .filter((action): action is ActionDef => !!action && evaluateWhen(action.when, ctx));
  const run = (action: ActionDef) => {
    const quick = { "continue-writing": "continue", "polish-writing": "polish", "expand-selection": "expand", "explain-selection": "explain", "summarize-note": "summarize" } as const;
    const id = quick[action.id as keyof typeof quick];
    if (id) { void plugin.runQuickAction(id, target); }
    else if (action.id === "ai-assistant") plugin.openAssistant(target);
    else if (action.id === "continue-writing-settings") { void plugin.continueWriting(true, target); }
    else if (action.id === "generate-next-chapter") { void plugin.generateNextChapter(ctx.activeFile); }
    else action.run(ctx);
  };

  // Separate pinned action (AI 助手) from grouped actions
  const pinnedAction = actions.find((a) => a.id === "ai-assistant");
  const groupedActions = actions.filter((a) => a.id !== "ai-assistant" && !quickIds.includes(a.id));

  const groups: PanelGroup[] = [];

  // Add pinned as first "group" with a special title
  if (pinnedAction && evaluateWhen(pinnedAction.when, ctx) && quickActions.length === 0) {
    groups.push({
      title: "入口",
      actions: [{
        id: pinnedAction.id,
        icon: pinnedAction.icon,
        label: pinnedAction.label,
        description: pinnedAction.description,
        callback: () => run(pinnedAction),
      }],
    });
  }

  for (const domainId of getDomainOrder(ctx)) {
    const domainActions = groupedActions.filter(
      (a) => a.domain === domainId && a.showIn.includes("panel") && evaluateWhen(a.when, ctx)
    );
    if (domainActions.length === 0) continue;
    groups.push({
      title: DOMAIN_TITLES[domainId],
      actions: domainActions.map((a) => ({
        id: a.id,
        icon: a.icon,
        label: a.label,
        description: a.description,
        callback: () => run(a),
      })),
    });
  }

  const shortLabels: Record<string, string> = {
    "polish-writing": "润色", "generate-next-chapter": "下一章", "continue-writing-settings": "设置",
  };
  new CommandPanelModal(plugin.app, groups, quickActions.map((action) => ({
    id: action.id, icon: action.icon, label: shortLabels[action.id] ?? action.label,
    description: action.description, callback: () => run(action),
  }))).open();
}

function buildContext(plugin: DeepSeekPlugin, targetFile: TFile | null): ActionContext {
  const activeFile = plugin.app.workspace.getActiveFile();
  const file = targetFile ?? activeFile;
  const fileMeta = file ? plugin.app.metadataCache.getFileCache(file) : null;
  const editor = plugin.app.workspace.activeEditor?.editor ?? null;

  return {
    plugin,
    app: plugin.app,
    editor,
    activeFile,
    selection: editor?.getSelection().trim() ?? "",
    fileContent: editor?.getValue() ?? "",
    fileType: fmString(frontmatterOf(fileMeta), "type"),
    filePath: file?.path ?? "",
    sectionName: null,
    targetFile,
  };
}

function evaluateWhen(when: ActionDef["when"], ctx: ActionContext): boolean {
  if (when.always) return true;
  if (when.hasEditor && !ctx.editor) return false;
  if (when.hasSelection && !ctx.selection) return false;
  if (when.noSelection && ctx.selection) return false;
  if (when.fileType && !when.fileType.some((t) => ctx.fileType === t)) return false;
  if (when.filePath && !ctx.filePath.includes(when.filePath)) return false;
  if (when.inSection && !ctx.sectionName) return false;
  return true;
}

/** 写作文件中时写作域置顶 */
function getDomainOrder(ctx: ActionContext): typeof DOMAIN_ORDER {
  const inWriting = ctx.fileType === "chapter" || ctx.fileType === "writing-project";
  if (!inWriting) return DOMAIN_ORDER;
  return ["writing", ...DOMAIN_ORDER.filter((d) => d !== "writing")];
}
