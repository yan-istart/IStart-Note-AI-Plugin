import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { requireApiVersion } from "obsidian";
import { PublishingDeviceConfig } from "./DeviceConfig";

vi.mock("obsidian", () => ({ requireApiVersion: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("publishing secret version compatibility", () => {
  it("never reads the new API on older apps and keeps session credentials usable", () => {
    vi.mocked(requireApiVersion).mockReturnValue(false);
    const app = {
      get loadLocalStorage(): never { throw new Error("API unavailable on this app"); },
      get saveLocalStorage(): never { throw new Error("API unavailable on this app"); },
      get secretStorage(): never { throw new Error("API unavailable on this app"); },
    } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    config.save();
    config.token = "session-token";
    expect(config.hasPersistentSecrets).toBe(false);
    expect(config.token).toBe("session-token");
  });
  it("persists device settings on 1.8.7 without accessing SecretStorage", () => {
    vi.mocked(requireApiVersion).mockImplementation(version => version === "1.8.7");
    const load = vi.fn(() => ({ url: "https://example.com" })), save = vi.fn();
    const app = {
      loadLocalStorage: load, saveLocalStorage: save,
      get secretStorage(): never { throw new Error("SecretStorage unavailable"); },
    } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    expect(config.value.url).toBe("https://example.com");
    config.save(); config.token = "session";
    expect(save).toHaveBeenCalledWith("istart-publishing-device-v1", config.value);
    expect(config.token).toBe("session"); expect(config.hasPersistentSecrets).toBe(false);
  });
  it("uses persistent, separately named secrets on supported apps", () => {
    vi.mocked(requireApiVersion).mockReturnValue(true);
    const secrets = new Map<string, string>();
    const app = { secretStorage: { getSecret: (key: string) => secrets.get(key) ?? null, setSecret: (key: string, value: string) => { secrets.set(key, value); } } } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    config.token = "remote"; config.value.mode = "local"; config.token = "local";
    expect(config.hasPersistentSecrets).toBe(true); expect(config.token).toBe("local");
    config.value.mode = "remote"; expect(config.token).toBe("remote");
    expect(secrets.size).toBe(2);
  });
  it("keeps the old local endpoint and access token for an independently started service", () => {
    vi.mocked(requireApiVersion).mockReturnValue(true);
    const id = "12345678-1234-1234-1234-123456789abc";
    const app = {
      loadLocalStorage: () => ({ id, mode: "local", port: 28123, nodePath: "/old/node", bridgePort: 28125 }),
      saveLocalStorage: vi.fn(),
      secretStorage: { getSecret: (key: string) => key === `istart-publishing-${id}-local` ? "existing-token" : null },
    } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    expect(config.value).toEqual({ id, mode: "local", port: 28123, url: "" });
    expect(config.token).toBe("existing-token");
    config.save();
    expect(app.saveLocalStorage).toHaveBeenCalledWith("istart-publishing-device-v1", config.value);
  });
});
