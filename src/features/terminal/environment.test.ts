import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { TerminalEnvironment, type EnvState, type TerminalIo } from "./environment";
import { DEFAULT_TERMINAL_SETTINGS } from "./types";

const VERSION = "2.9.1";

function serviceZip(): Uint8Array {
  return zipSync({ "terminal-service.cjs": strToU8("// bundled terminal service") });
}

function fakeIo(overrides: Partial<TerminalIo> = {}) {
  const files = new Map<string, string | Uint8Array>();
  const io: TerminalIo = {
    exec: async () => ({ ok: true, stdout: "v24.14.1", stderr: "" }),
    spawnDetached: vi.fn(() => {}),
    homeDir: () => "/home/test",
    join: (...parts) => parts.join("/"),
    mkdir: async () => {},
    exists: async path => files.has(path),
    readText: async path => {
      const value = files.get(path);
      if (typeof value === "string") return value;
      throw new Error("missing");
    },
    writeText: async (path, text) => { files.set(path, text); },
    writeBinary: async (path, data) => { files.set(path, data); },
    readBinary: async path => {
      const value = files.get(path);
      if (value instanceof Uint8Array) return value;
      throw new Error("missing");
    },
    listDir: async () => [...files.keys()].map(key => key.split("/").pop() ?? "").filter((name, index, all) => name && all.indexOf(name) === index),
    chmod: vi.fn(async () => {}),
    rename: async (from, to) => {
      for (const [key, value] of [...files]) {
        if (key.startsWith(from)) { files.delete(key); files.set(`${to}${key.slice(from.length)}`, value); }
      }
    },
    remove: async path => {
      for (const key of [...files.keys()]) if (key.startsWith(path)) files.delete(key);
    },
    download: vi.fn(async () => serviceZip()),
    getJson: vi.fn(async () => null),
    shutdown: vi.fn(async () => true),
    sleep: async () => {},
    randomToken: () => "a".repeat(48),
    ...overrides,
  };
  return { io, files };
}

function settings(overrides: Partial<{ defaultLocation: "note" | "vault"; port: number; nodePath: string }> = {}) {
  return { ...DEFAULT_TERMINAL_SETTINGS, ...overrides };
}

describe("terminal environment supervisor", () => {
  it("reports a missing Node.js environment", async () => {
    const { io } = fakeIo({ exec: async () => ({ ok: false, stdout: "", stderr: "ENOENT" }) });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    expect((await env.status()).state).toBe<EnvState>("missing-node");
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("missing-node");
    expect(io.download).not.toHaveBeenCalled();
  });

  it("reports an outdated Node.js environment", async () => {
    const { io } = fakeIo({ exec: async () => ({ ok: true, stdout: "v22.11.0", stderr: "" }) });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    expect((await env.status()).state).toBe<EnvState>("outdated-node");
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("outdated-node");
    expect(io.download).not.toHaveBeenCalled();
  });

  it("downloads, installs and starts the service, then reports ready", async () => {
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    // Health is unavailable until the service starts.
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return files.has("/home/test/.istart-terminal/2.9.1/terminal-service.cjs") && spawnMock.mock.calls.length > 0
        ? { status: 200, body: { version: VERSION } }
        : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const steps: string[] = [];
    const status = await env.ensure(progress => steps.push(progress.step));
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).toHaveBeenCalledTimes(1);
    expect(files.get("/home/test/.istart-terminal/2.9.1/terminal-service.cjs")).toBeDefined();
    expect(io.spawnDetached).toHaveBeenCalledWith("node", ["/home/test/.istart-terminal/2.9.1/terminal-service.cjs"], expect.objectContaining({
      cwd: "/home/test/.istart-terminal/2.9.1",
      env: expect.objectContaining({ ISTART_TERMINAL_TOKEN: expect.any(String), ISTART_TERMINAL_PORT: "27126" }),
    }));
    expect(steps).toContain("download");
    expect(steps).toContain("start");
  });

  it("reuses a healthy service of the same version without downloading or starting", async () => {
    const { io } = fakeIo({ getJson: async () => ({ status: 200, body: { version: VERSION } }) });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).not.toHaveBeenCalled();
    expect(io.spawnDetached).not.toHaveBeenCalled();
  });

  it("stops an outdated instance before deploying the new version", async () => {
    const { io } = fakeIo({ getJson: async () => ({ status: 200, body: { version: "2.8.0" } }) });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.shutdown).toHaveBeenCalledWith("http://127.0.0.1:27126/shutdown", expect.any(String));
    expect(io.download).toHaveBeenCalled();
  });

  it("reuses an already-installed bundle and only starts it", async () => {
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    files.set("/home/test/.istart-terminal/2.9.1/terminal-service.cjs", "// already installed");
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).not.toHaveBeenCalled();
    expect(io.spawnDetached).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared port and token config across versions", async () => {
    const { io, files } = fakeIo();
    files.set("/home/test/.istart-terminal/config.json", JSON.stringify({ port: 27127, token: "existing-token-1234567890123456" }));
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const config = await env.config();
    expect(config).toEqual({ port: 27127, token: "existing-token-1234567890123456" });
  });

  it("finds Node through login-shell resolution when the GUI PATH lacks it", async () => {
    const nvmNode = "/Users/me/.nvm/versions/node/v24.1.0/bin/node";
    const exec = vi.fn(async (command: string) => {
      if (command === "node") return { ok: false, stdout: "", stderr: "ENOENT" };
      if (command.includes("bash") || command.includes("zsh")) {
        return { ok: true, stdout: `noise\nISTART_NODE_BEGIN\n${nvmNode}\nISTART_NODE_END\n`, stderr: "" };
      }
      if (command === nvmNode) return { ok: true, stdout: "v24.1.0", stderr: "" };
      return { ok: false, stdout: "", stderr: "ENOENT" };
    });
    const { io } = fakeIo({ exec });
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    const node = await env.resolveNode();
    expect(node).toEqual({ path: nvmNode, version: "v24.1.0" });
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.spawnDetached).toHaveBeenCalledWith(nvmNode, ["/home/test/.istart-terminal/2.9.1/terminal-service.cjs"], expect.anything());
  });

  it("finds Node in a common install location when neither PATH nor shell resolve it", async () => {
    const systemNode = "/usr/local/bin/node";
    const exec = vi.fn(async (command: string) => {
      if (command === "node" || command.includes("bash") || command.includes("zsh")) return { ok: false, stdout: "", stderr: "ENOENT" };
      if (command === systemNode) return { ok: true, stdout: "v24.2.0", stderr: "" };
      return { ok: false, stdout: "", stderr: "ENOENT" };
    });
    const { io, files } = fakeIo({ exec });
    files.set(systemNode, "");
    const env = new TerminalEnvironment(io, VERSION, () => settings());
    expect(await env.resolveNode()).toEqual({ path: systemNode, version: "v24.2.0" });
  });

  it("prefers the manual nodePath override", async () => {
    const custom = "/custom/node";
    const exec = vi.fn(async (command: string) => {
      if (command === custom) return { ok: true, stdout: "v24.9.0", stderr: "" };
      return { ok: false, stdout: "", stderr: "ENOENT" };
    });
    const { io } = fakeIo({ exec });
    const env = new TerminalEnvironment(io, VERSION, () => settings({ nodePath: custom }));
    expect(await env.resolveNode()).toEqual({ path: custom, version: "v24.9.0" });
  });

  it("installs a service zip shipped in the plugin directory before downloading", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    files.set(`${pluginDir}/terminal-service-${VERSION}.zip`, serviceZip());
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const steps: string[] = [];
    const status = await env.ensure(progress => steps.push(progress.step));
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).not.toHaveBeenCalled();
    expect(steps).toContain("extract");
    expect(files.get("/home/test/.istart-terminal/2.9.1/terminal-service.cjs")).toBeDefined();
  });

  it("downloads from GitHub when no local zip is bundled", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).toHaveBeenCalledTimes(1);
  });

  it("accepts a locally built zip whose version name differs from the plugin version", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    files.set(`${pluginDir}/terminal-service-2.9.2.zip`, serviceZip());
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).not.toHaveBeenCalled();
    expect(files.get("/home/test/.istart-terminal/2.9.1/terminal-service.cjs")).toBeDefined();
  });

  it("runs the service directly from the plugin folder when it is extracted there", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    files.set(`${pluginDir}/terminal-service.cjs`, "// extracted service");
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.download).not.toHaveBeenCalled();
    expect(io.spawnDetached).toHaveBeenCalledWith("node", [`${pluginDir}/terminal-service.cjs`], expect.objectContaining({ cwd: pluginDir }));
  });

  it("restores the executable bit on the node-pty spawn-helper after extraction", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io, files } = fakeIo();
    const spawnMock = io.spawnDetached as ReturnType<typeof vi.fn>;
    const helper = `node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/${process.platform}-${process.arch}/spawn-helper`;
    files.set(`${pluginDir}/terminal-service-${VERSION}.zip`, zipSync({
      "terminal-service.cjs": strToU8("// service"),
      [helper]: strToU8("binary"),
    }));
    (io.getJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      return spawnMock.mock.calls.length > 0 ? { status: 200, body: { version: VERSION } } : null;
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("ready");
    expect(io.chmod).toHaveBeenCalledWith(`/home/test/.istart-terminal/${VERSION}/${helper}`, 0o755);
  });

  it("reports the checked paths when downloading fails", async () => {
    const pluginDir = "/vault/.obsidian/plugins/istart-note-ai";
    const { io } = fakeIo({
      download: vi.fn(async () => { throw new Error("无法连接 GitHub 下载终端服务包:Failed to fetch"); }),
    });
    const env = new TerminalEnvironment(io, VERSION, () => settings(), () => pluginDir);
    const status = await env.ensure(() => {});
    expect(status.state).toBe<EnvState>("failed");
    expect(status.error).toContain("Failed to fetch");
    expect(status.error).toContain(pluginDir);
  });
});
