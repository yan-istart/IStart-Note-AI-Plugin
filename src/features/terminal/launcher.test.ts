import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import type DeepSeekPlugin from "../../main";
import {
  buildLaunch,
  launchTarget,
  linuxCandidates,
  resolveTerminalTarget,
  type SpawnFn,
  type SpawnProcess,
  type TerminalTarget,
} from "./launcher";
import { DEFAULT_TERMINAL_SETTINGS, type TerminalSettings } from "./types";

function plugin(activeFile: TFile | null = null, base = "/Users/me/Vault"): DeepSeekPlugin {
  return {
    app: {
      vault: { adapter: { getBasePath: () => base } },
      workspace: { getActiveFile: () => activeFile },
    },
  } as unknown as DeepSeekPlugin;
}

function note(path: string): TFile {
  const parent = { path: path.split("/").slice(0, -1).join("/") };
  return { path, parent } as unknown as TFile;
}

function settings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return { ...DEFAULT_TERMINAL_SETTINGS, ...overrides };
}

function target(directory: string): TerminalTarget {
  return { directory, label: "test", source: "note" };
}

type FakeEvent = { type: "error"; code?: string } | { type: "exit"; code: number | null } | { type: "spawn" };

function fakeProcess(events: FakeEvent[]): SpawnProcess {
  const handlers = {
    on(event: string, listener: (...args: never[]) => void) {
      const queued = events.filter(entry => entry.type === event);
      queueMicrotask(() => {
        for (const entry of queued) {
          const invoke = listener as unknown as (arg?: unknown) => void;
          if (entry.type === "error") invoke(Object.assign(new Error("启动失败"), { code: entry.code ?? "" }));
          else if (entry.type === "exit") invoke((entry as { code: number | null }).code);
          else invoke();
        }
      });
      return handlers;
    },
  };
  return handlers as unknown as SpawnProcess;
}

function fakeSpawn(plan: Record<string, FakeEvent[]>) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const spawn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return fakeProcess(plan[command] ?? []);
  };
  return { spawn, calls };
}

describe("terminal target resolution", () => {
  const defaults = settings();

  it("targets the active note folder for note intent", () => {
    const result = resolveTerminalTarget(plugin(note("Writing/Novels/书/01-章节.md")), defaults, "note");
    expect(result?.directory).toBe("/Users/me/Vault/Writing/Novels/书");
    expect(result?.source).toBe("note");
  });

  it("falls back to the vault root without an active note", () => {
    const result = resolveTerminalTarget(plugin(), defaults, "note");
    expect(result?.directory).toBe("/Users/me/Vault");
    expect(result?.source).toBe("vault");
  });

  it("always targets the vault root for vault intent", () => {
    const result = resolveTerminalTarget(plugin(note("a/b.md")), defaults, "vault");
    expect(result?.directory).toBe("/Users/me/Vault");
    expect(result?.source).toBe("vault");
  });

  it("follows the default-location setting for default intent", () => {
    expect(resolveTerminalTarget(plugin(note("a/b.md")), defaults, "default")?.source).toBe("note");
    expect(resolveTerminalTarget(plugin(note("a/b.md")), settings({ defaultLocation: "vault" }), "default")?.source).toBe("vault");
  });

  it("returns null when the vault base path is unavailable", () => {
    expect(resolveTerminalTarget(plugin(note("a/b.md"), ""), defaults, "default")).toBeNull();
  });
});

describe("launch command building", () => {
  const dir = target("/Users/me/Vault/我的 笔记");

  it("opens the configured app on macOS", () => {
    expect(buildLaunch(dir, settings(), "mac")).toEqual({ command: "open", args: ["-a", "Terminal", "/Users/me/Vault/我的 笔记"] });
    expect(buildLaunch(dir, settings({ macTerminalApp: "iTerm" }), "mac").args).toEqual(["-a", "iTerm", "/Users/me/Vault/我的 笔记"]);
  });

  it("starts cmd on Windows with the directory quoted", () => {
    expect(buildLaunch(dir, settings(), "win")).toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", 'start "" cmd.exe /K "cd /d /Users/me/Vault/我的 笔记"'],
    });
  });

  it("tries common Linux terminals in order", () => {
    expect(linuxCandidates(dir, settings()).map(candidate => candidate.command)).toEqual(["gnome-terminal", "konsole", "x-terminal-emulator"]);
  });

  it("uses the Linux terminal template", () => {
    const candidates = linuxCandidates(dir, settings({ linuxTerminalTemplate: "kitty --directory {{dir}}" }));
    expect(candidates).toEqual([{ command: "kitty", args: ["--directory", "/Users/me/Vault/我的 笔记"] }]);
  });
});

describe("launchTarget", () => {
  const dir = target("/vault");

  it("resolves after a successful launcher exit", async () => {
    const { spawn, calls } = fakeSpawn({ open: [{ type: "exit", code: 0 }] });
    await launchTarget(dir, settings(), "mac", spawn);
    expect(calls).toEqual([{ command: "open", args: ["-a", "Terminal", "/vault"] }]);
  });

  it("rejects when the macOS app is missing", async () => {
    const { spawn } = fakeSpawn({ open: [{ type: "exit", code: 1 }] });
    await expect(launchTarget(dir, settings(), "mac", spawn)).rejects.toThrow("退出代码 1");
  });

  it("rejects on a spawn error", async () => {
    const { spawn } = fakeSpawn({ open: [{ type: "error", code: "EPERM" }] });
    await expect(launchTarget(dir, settings(), "mac", spawn)).rejects.toThrow("启动失败");
  });

  it("falls through ENOENT Linux terminals to the next candidate", async () => {
    const { spawn, calls } = fakeSpawn({
      "gnome-terminal": [{ type: "error", code: "ENOENT" }],
      konsole: [{ type: "spawn" }],
    });
    await launchTarget(dir, settings(), "linux", spawn);
    expect(calls.map(call => call.command)).toEqual(["gnome-terminal", "konsole"]);
  });

  it("stops on a non-ENOENT Linux error", async () => {
    const { spawn, calls } = fakeSpawn({
      "gnome-terminal": [{ type: "error", code: "EPERM" }],
      konsole: [{ type: "spawn" }],
    });
    await expect(launchTarget(dir, settings(), "linux", spawn)).rejects.toThrow("启动失败");
    expect(calls.map(call => call.command)).toEqual(["gnome-terminal"]);
  });
});
