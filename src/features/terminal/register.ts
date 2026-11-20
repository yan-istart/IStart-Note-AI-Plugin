import { Platform, TFile } from "obsidian";
import type DeepSeekPlugin from "../../main";
import { openTerminalAt } from "./launcher";
import { TerminalView, TERMINAL_VIEW_TYPE } from "./TerminalView";

/** Desktop-only terminal launcher: workbench tab, commands and context-menu entries. */
export function registerTerminal(plugin: DeepSeekPlugin): void {
  if (!Platform.isDesktopApp) return;

  plugin.registerView(TERMINAL_VIEW_TYPE, leaf => new TerminalView(leaf, plugin));

  plugin.addCommand({
    id: "terminal-open",
    name: "在终端打开",
    callback: () => { void openTerminalAt(plugin, "default"); },
  });
  plugin.addCommand({
    id: "terminal-open-note-folder",
    name: "在终端打开当前笔记所在目录",
    callback: () => { void openTerminalAt(plugin, "note"); },
  });
  plugin.addCommand({
    id: "terminal-open-vault",
    name: "在终端打开 Vault",
    callback: () => { void openTerminalAt(plugin, "vault"); },
  });

  plugin.registerEvent(plugin.app.workspace.on("editor-menu", (menu, _editor, view) => {
    const file = (view as { file?: TFile | null }).file ?? null;
    menu.addItem(item => item
      .setTitle("在终端打开所在目录")
      .setIcon("terminal")
      .onClick(() => { void openTerminalAt(plugin, "note", file); }));
  }));

  plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file) => {
    if (!(file instanceof TFile)) return;
    menu.addItem(item => item
      .setTitle("在终端打开所在目录")
      .setIcon("terminal")
      .onClick(() => { void openTerminalAt(plugin, "note", file); }));
  }));
}
