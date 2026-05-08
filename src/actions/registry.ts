import { Notice, TFile } from "obsidian";
import type DeepSeekPlugin from "../main";
import { ActionDef, ActionContext, ActionEntry, ActionGroup, GROUP_TITLES, GROUP_ORDER } from "./types";
import { CommandPanelModal } from "../features/command-panel/CommandPanelModal";
import type { PanelGroup, PanelAction } from "../features/command-panel/CommandPanelModal";
import { SectionAppender } from "../ai/SectionAppender";

/**
 * 注册所有 actions 到插件的各个入口（命令、右键菜单、面板）
 */
export function registerAllActions(plugin: DeepSeekPlugin, actions: ActionDef[]) {
  // 1. 为每个 action 注册命令
  // 需要编辑器的 action 用 editorCallback（移动端工具栏可用）
  for (const action of actions) {
    const needsEditor = action.showIn.includes("editor-menu") || action.when.hasSelection || action.when.inSection || action.when.noSelection;

    if (needsEditor) {
      plugin.addCommand({
        id: action.id,
        name: action.label,
        editorCallback: (editor) => {
          const ctx = buildContext(plugin, null);
          ctx.editor = editor;
          ctx.selection = editor.getSelection().trim();
          ctx.fileContent = editor.getValue();
          const cursor = editor.getCursor();
          const appender = new SectionAppender(plugin.app, plugin.settings);
          ctx.sectionName = appender.getSectionAtCursor(ctx.fileContent, cursor.line);
          if (evaluateWhen(action.when, ctx)) {
            action.run(ctx);
          } else {
            new Notice(`当前上下文不支持此操作`);
          }
        },
      });
    } else {
      plugin.addCommand({
        id: action.id,
        name: action.label,
        callback: () => {
          const ctx = buildContext(plugin, null);
          if (evaluateWhen(action.when, ctx)) {
            action.run(ctx);
          } else {
            new Notice(`当前上下文不支持此操作`);
          }
        },
      });
    }
  }

  // 2. 注册 editor-menu
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      const ctx = buildContext(plugin, null);
      ctx.editor = editor;
      ctx.selection = editor.getSelection().trim();
      ctx.fileContent = editor.getValue();

      // 重新计算 sectionName
      const cursor = editor.getCursor();
      const appender = new SectionAppender(plugin.app, plugin.settings);
      ctx.sectionName = appender.getSectionAtCursor(ctx.fileContent, cursor.line);

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

  // 3. 注册 file-menu
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;

      const fileMeta = plugin.app.metadataCache.getFileCache(file);
      const fileType = fileMeta?.frontmatter?.type as string | undefined;

      const ctx = buildContext(plugin, file);
      ctx.fileType = fileType;
      ctx.filePath = file.path;
      ctx.targetFile = file;

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

  // 4. 注册面板打开命令
  plugin.addCommand({
    id: "open-panel",
    name: "Open command panel",
    callback: () => openPanel(plugin, actions),
  });

  // 5. Ribbon icon 打开面板
  plugin.addRibbonIcon("brain", "IStart-Note-AI", () => {
    openPanel(plugin, actions);
  });
}

/** 打开统一面板 */
function openPanel(plugin: DeepSeekPlugin, actions: ActionDef[]) {
  const editor = plugin.app.workspace.activeEditor?.editor ?? null;
  const ctx = buildContext(plugin, null);
  if (editor) {
    ctx.editor = editor;
    ctx.selection = editor.getSelection().trim();
    ctx.fileContent = editor.getValue();
    const cursor = editor.getCursor();
    const appender = new SectionAppender(plugin.app, plugin.settings);
    ctx.sectionName = appender.getSectionAtCursor(ctx.fileContent, cursor.line);
  }

  // 按 group 分组，过滤可见 actions
  const groups: PanelGroup[] = [];

  for (const groupId of GROUP_ORDER) {
    const groupActions = actions.filter(
      (a) => a.group === groupId && a.showIn.includes("panel") && evaluateWhen(a.when, ctx)
    );
    if (groupActions.length === 0) continue;

    const panelActions: PanelAction[] = groupActions.map((a) => ({
      id: a.id,
      icon: a.icon,
      label: a.label,
      description: a.description,
      callback: () => a.run(ctx),
    }));

    groups.push({ title: GROUP_TITLES[groupId], actions: panelActions });
  }

  new CommandPanelModal(plugin.app, groups).open();
}

/** 构建当前上下文 */
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

/** 评估可见性条件 */
function evaluateWhen(when: ActionDef["when"], ctx: ActionContext): boolean {
  if (when.always) return true;

  if (when.hasSelection && !ctx.selection) return false;
  if (when.noSelection && ctx.selection) return false;

  if (when.fileType) {
    const match = when.fileType.some((t) => ctx.fileType === t) ||
      (when.filePath && ctx.filePath.includes(when.filePath));
    if (!match) return false;
  } else if (when.filePath) {
    if (!ctx.filePath.includes(when.filePath)) return false;
  }

  if (when.inSection && !ctx.sectionName) return false;

  return true;
}
