import { Notice, TFile } from "obsidian";
import type DeepSeekPlugin from "../main";
import { ActionDef, ActionContext, DOMAIN_TITLES, DOMAIN_ORDER } from "./types";
import { CommandPanelModal } from "../features/command-panel/CommandPanelModal";
import type { PanelGroup, PanelAction } from "../features/command-panel/CommandPanelModal";

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
        editorCallback: () => {
          const ctx = buildContext(plugin, null);
          action.run(ctx);
        },
      });
    } else {
      plugin.addCommand({
        id: action.id,
        name: action.label,
        callback: () => {
          const ctx = buildContext(plugin, null);
          action.run(ctx);
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
    name: "Open command panel",
    callback: () => openPanel(plugin, actions),
  });

  plugin.addRibbonIcon("brain", "IStart-Note-AI", () => {
    openPanel(plugin, actions);
  });
}

function openPanel(plugin: DeepSeekPlugin, actions: ActionDef[]) {
  const ctx = buildContext(plugin, null);
  const editor = plugin.app.workspace.activeEditor?.editor ?? null;
  if (editor) {
    ctx.editor = editor;
    ctx.selection = editor.getSelection().trim();
  }

  const groups: PanelGroup[] = [];
  for (const domainId of DOMAIN_ORDER) {
    const domainActions = actions.filter(
      (a) => a.domain === domainId && a.showIn.includes("panel") && evaluateWhen(a.when, ctx)
    );
    if (domainActions.length === 0) continue;
    groups.push({
      title: DOMAIN_TITLES[domainId],
      actions: domainActions.map((a) => ({
        id: a.id,
        icon: a.icon,
        label: a.label + (a.experimental ? " ⚗️" : ""),
        description: a.description,
        callback: () => a.run(ctx),
      })),
    });
  }

  new CommandPanelModal(plugin.app, groups).open();
}

function buildContext(plugin: DeepSeekPlugin, targetFile: TFile | null): ActionContext {
  const activeFile = plugin.app.workspace.getActiveFile();
  const file = targetFile ?? activeFile;
  const fileMeta = file ? plugin.app.metadataCache.getFileCache(file) : null;

  return {
    plugin,
    app: plugin.app,
    editor: null,
    activeFile,
    selection: "",
    fileContent: "",
    fileType: fileMeta?.frontmatter?.type as string | undefined,
    filePath: file?.path ?? "",
    sectionName: null,
    targetFile,
  };
}

function evaluateWhen(when: ActionDef["when"], ctx: ActionContext): boolean {
  if (when.always) return true;
  if (when.hasSelection && !ctx.selection) return false;
  if (when.noSelection && ctx.selection) return false;
  if (when.fileType && !when.fileType.some((t) => ctx.fileType === t)) return false;
  if (when.filePath && !ctx.filePath.includes(when.filePath)) return false;
  if (when.inSection && !ctx.sectionName) return false;
  return true;
}
