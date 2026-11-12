import { TFile } from "obsidian";
import { frontmatterOf, fmString } from "../util/frontmatter";
import type DeepSeekPlugin from "../main";
import { ActionDef, ActionContext } from "./types";

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

  // 4. 保留旧命令 ID；统一进入助手。
  plugin.addCommand({
    id: "open-panel",
    name: "打开 AI 助手（原功能面板）",
    icon: "istart-assistant",
    callback: () => openPanel(plugin, actions),
  });

  plugin.addRibbonIcon("istart-assistant", "IStart 工作台", () => plugin.openAssistant());
}

/** Compatibility alias for integrations that used the removed panel. */
export function openPanel(plugin: DeepSeekPlugin, _actions: ActionDef[]) { plugin.openAssistant(); }

export function buildContext(plugin: DeepSeekPlugin, targetFile: TFile | null): ActionContext {
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

export function evaluateWhen(when: ActionDef["when"], ctx: ActionContext): boolean {
  if (when.always) return true;
  if (when.hasEditor && !ctx.editor) return false;
  if (when.hasSelection && !ctx.selection) return false;
  if (when.noSelection && ctx.selection) return false;
  if (when.fileType && !when.fileType.some((t) => ctx.fileType === t)) return false;
  if (when.filePath && !ctx.filePath.includes(when.filePath)) return false;
  if (when.inSection && !ctx.sectionName) return false;
  return true;
}
