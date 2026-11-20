/** Desktop terminal launcher settings. Device-local, excluded from cross-device config sync. */
export interface TerminalSettings {
  /** Which directory the default "在终端打开" entry targets. */
  defaultLocation: "note" | "vault";
  /** macOS application passed to `open -a`, e.g. Terminal or iTerm. */
  macTerminalApp: string;
  /** Linux override: space-separated argv template; `{{dir}}` is replaced by the target directory. */
  linuxTerminalTemplate: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  defaultLocation: "note",
  macTerminalApp: "Terminal",
  linuxTerminalTemplate: "",
};

export function loadTerminalSettings(saved?: Partial<TerminalSettings>): TerminalSettings {
  return {
    ...DEFAULT_TERMINAL_SETTINGS,
    ...saved,
    defaultLocation: saved?.defaultLocation === "vault" ? "vault" : "note",
    macTerminalApp: typeof saved?.macTerminalApp === "string" && saved.macTerminalApp.trim()
      ? saved.macTerminalApp.trim()
      : "Terminal",
    linuxTerminalTemplate: typeof saved?.linuxTerminalTemplate === "string" ? saved.linuxTerminalTemplate : "",
  };
}
