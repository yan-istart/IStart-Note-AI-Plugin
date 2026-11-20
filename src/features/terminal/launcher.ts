import { Notice, Platform, TFile, normalizePath } from "obsidian";
import type DeepSeekPlugin from "../../main";
import type { TerminalSettings } from "./types";

/** Where the terminal should open. */
export interface TerminalTarget {
  directory: string;
  label: string;
  source: "note" | "vault";
}

/** `default` follows the saved preference; `note` / `vault` are explicit. */
export type TerminalIntent = "default" | "note" | "vault";
export type TerminalPlatform = "mac" | "win" | "linux";

/** Minimal surface of the spawned process, injectable for tests. */
export interface SpawnProcess {
  on(event: "error", listener: (error: Error) => void): SpawnProcess;
  on(event: "exit", listener: (code: number | null) => void): SpawnProcess;
  on(event: "spawn", listener: () => void): SpawnProcess;
}
export type SpawnFn = (command: string, args: string[]) => SpawnProcess;

export interface LaunchCommand {
  command: string;
  args: string[];
}

export function currentPlatform(): TerminalPlatform {
  if (Platform.isMacOS) return "mac";
  if (Platform.isWin) return "win";
  return "linux";
}

/** Absolute vault path from the filesystem adapter (desktop only). */
export function vaultBasePath(plugin: DeepSeekPlugin): string {
  const adapter = plugin.app.vault.adapter as unknown as { getBasePath?: () => string };
  return adapter?.getBasePath?.()?.trim() ?? "";
}

/** Resolve the directory a terminal should open in, falling back to the vault root. */
export function resolveTerminalTarget(
  plugin: DeepSeekPlugin,
  settings: TerminalSettings,
  intent: TerminalIntent,
  file?: TFile | null,
): TerminalTarget | null {
  const base = vaultBasePath(plugin);
  if (!base) return null;
  const useVault = intent === "vault" || (intent === "default" && settings.defaultLocation === "vault");
  const note = file ?? plugin.app.workspace.getActiveFile();
  const folder = useVault ? "" : note?.parent?.path ?? "";
  const root = base.replace(/[\\/]+$/, "");
  const directory = folder ? `${root}/${normalizePath(folder)}` : root;
  if (folder) return { directory, label: `当前笔记目录：${folder}`, source: "note" };
  return { directory, label: "Vault 根目录", source: "vault" };
}

/** Build the open-terminal command for a single platform. */
export function buildLaunch(target: TerminalTarget, settings: TerminalSettings, platform: TerminalPlatform): LaunchCommand {
  if (platform === "mac") {
    return { command: "open", args: ["-a", settings.macTerminalApp?.trim() || "Terminal", target.directory] };
  }
  if (platform === "win") {
    // `start` is a cmd builtin; the trailing /K keeps the window open after cd.
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `start "" cmd.exe /K "cd /d ${target.directory}"`] };
  }
  return linuxCandidates(target, settings)[0] ?? { command: "x-terminal-emulator", args: [] };
}

/** Linux terminals are tried in order; a custom template replaces the defaults. */
export function linuxCandidates(target: TerminalTarget, settings: TerminalSettings): LaunchCommand[] {
  const dir = target.directory;
  const template = settings.linuxTerminalTemplate.trim();
  if (template) {
    const parts = template.split(/\s+/).filter(Boolean).map(part => part.replace(/\{\{dir\}\}/g, dir));
    return parts.length ? [{ command: parts[0], args: parts.slice(1) }] : [];
  }
  return [
    { command: "gnome-terminal", args: ["--working-directory", dir] },
    { command: "konsole", args: ["--workdir", dir] },
    // Last resort: land in the directory with a shell that stays interactive.
    { command: "x-terminal-emulator", args: ["-e", `sh -c 'cd ${shellQuote(dir)} && exec "$SHELL"'`] },
  ];
}

/**
 * Launch the terminal for a target directory.
 * macOS/Windows launchers exit quickly, so their exit code is awaited;
 * Linux terminals keep running and resolve as soon as the process starts.
 */
export async function launchTarget(
  target: TerminalTarget,
  settings: TerminalSettings,
  platform: TerminalPlatform,
  spawn: SpawnFn,
): Promise<void> {
  if (platform === "linux") {
    const candidates = linuxCandidates(target, settings);
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        await runOnce(candidate, spawn, false);
        return;
      } catch (error) {
        const err = toError(error);
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        lastError = err;
      }
    }
    throw lastError ?? new Error("未找到可用的终端程序");
  }
  await runOnce(buildLaunch(target, settings, platform), spawn, true);
}

/** Open the terminal for the given intent and report failures with a clipboard fallback. */
export async function openTerminalAt(
  plugin: DeepSeekPlugin,
  intent: TerminalIntent,
  file?: TFile | null,
  options: { spawn?: SpawnFn; copy?: (text: string) => Promise<void> } = {},
): Promise<void> {
  const settings = plugin.settings.terminal;
  const target = resolveTerminalTarget(plugin, settings, intent, file);
  if (!target) {
    new Notice("无法获取 Vault 目录（仅桌面端可用）");
    return;
  }
  const spawn = options.spawn ?? systemSpawn;
  const copy = options.copy ?? copyDirectory;
  try {
    await launchTarget(target, settings, currentPlatform(), spawn);
    new Notice(`已打开终端：${target.label}`);
  } catch (error) {
    const message = toError(error).message;
    const copied = await copy(target.directory).then(() => true).catch(() => false);
    new Notice(
      copied
        ? `无法启动终端：${message}。目录路径已复制到剪贴板，可粘贴到终端使用`
        : `无法启动终端：${message}`,
      9000,
    );
  }
}

function runOnce(command: LaunchCommand, spawn: SpawnFn, waitForExit: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let proc: SpawnProcess;
    try {
      proc = spawn(command.command, command.args);
    } catch (error) {
      reject(toError(error));
      return;
    }
    proc.on("error", error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    if (waitForExit) {
      proc.on("exit", code => {
        if (settled) return;
        settled = true;
        if (code === 0 || code === null) resolve();
        else reject(new Error(`${command.command} 退出代码 ${code}`));
      });
    } else {
      proc.on("spawn", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      proc.on("exit", code => {
        if (!settled && code !== 0 && code !== null) {
          settled = true;
          reject(new Error(`${command.command} 退出代码 ${code}`));
        }
      });
    }
  });
}

/** Desktop Obsidian exposes Node built-ins through its CJS loader; keep the call lazy. */
function systemSpawn(command: string, args: string[]): SpawnProcess {
  if (!Platform.isDesktopApp) throw new Error("终端启动仅支持桌面端");
  const childProcess = require("child_process") as typeof import("child_process");
  return childProcess.spawn(command, args, { detached: true, stdio: "ignore" });
}

async function copyDirectory(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("剪贴板不可用");
  await navigator.clipboard.writeText(text);
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
