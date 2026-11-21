/** Desktop terminal settings: embedded console + system-terminal launcher. Device-local, excluded from cross-device config sync. */
export interface TerminalSettings {
  /** Which directory the default "在终端打开" entry targets. */
  defaultLocation: "note" | "vault";
  /** macOS application passed to `open -a`, e.g. Terminal or iTerm. */
  macTerminalApp: string;
  /** Linux override: space-separated argv template; `{{dir}}` is replaced by the target directory. */
  linuxTerminalTemplate: string;
  /** Local terminal service port (embedded console). */
  port: number;
  /** Deployed terminal service version; empty means not deployed yet. */
  serviceVersion: string;
  /** Manual Node.js binary override; empty means auto-detect. */
  nodePath: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  defaultLocation: "note",
  macTerminalApp: "Terminal",
  linuxTerminalTemplate: "",
  port: 27126,
  serviceVersion: "",
  nodePath: "",
};

export function loadTerminalSettings(saved?: Partial<TerminalSettings>): TerminalSettings {
  const port = typeof saved?.port === "number" && Number.isInteger(saved.port) && saved.port >= 1024 && saved.port <= 65535
    ? saved.port
    : DEFAULT_TERMINAL_SETTINGS.port;
  return {
    ...DEFAULT_TERMINAL_SETTINGS,
    ...saved,
    defaultLocation: saved?.defaultLocation === "vault" ? "vault" : "note",
    macTerminalApp: typeof saved?.macTerminalApp === "string" && saved.macTerminalApp.trim()
      ? saved.macTerminalApp.trim()
      : "Terminal",
    linuxTerminalTemplate: typeof saved?.linuxTerminalTemplate === "string" ? saved.linuxTerminalTemplate : "",
    port,
    serviceVersion: typeof saved?.serviceVersion === "string" ? saved.serviceVersion : "",
    nodePath: typeof saved?.nodePath === "string" ? saved.nodePath.trim() : "",
  };
}
