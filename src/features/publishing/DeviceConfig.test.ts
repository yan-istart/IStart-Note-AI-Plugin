import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { requireApiVersion } from "obsidian";
import { PublishingDeviceConfig } from "./DeviceConfig";

vi.mock("obsidian", () => ({ requireApiVersion: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe("publishing secret version compatibility", () => {
  it("never reads the new API on older apps and keeps session credentials usable", () => {
    vi.mocked(requireApiVersion).mockReturnValue(false);
    const app = { get secretStorage(): never { throw new Error("API unavailable on this app"); } } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    config.token = "session-token"; config.extensionToken = "session-extension";
    expect(config.hasPersistentSecrets).toBe(false);
    expect(config.token).toBe("session-token"); expect(config.extensionToken).toBe("session-extension");
  });
  it("uses persistent, separately named secrets on supported apps", () => {
    vi.mocked(requireApiVersion).mockReturnValue(true);
    const secrets = new Map<string, string>();
    const app = { secretStorage: { getSecret: (key: string) => secrets.get(key) ?? null, setSecret: (key: string, value: string) => { secrets.set(key, value); } } } as unknown as App;
    const config = new PublishingDeviceConfig(app);
    config.token = "remote"; config.value.mode = "local"; config.token = "local"; config.extensionToken = "extension";
    expect(config.hasPersistentSecrets).toBe(true); expect(config.token).toBe("local");
    config.value.mode = "remote"; expect(config.token).toBe("remote");
    expect(config.extensionToken).toBe("extension"); expect(secrets.size).toBe(3);
  });
});
