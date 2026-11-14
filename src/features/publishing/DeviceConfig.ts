import type { App } from "obsidian";
import { requireApiVersion } from "obsidian";

export interface PublishingDevice {
  id: string;
  mode: "local" | "remote";
  url: string;
  port: number;
}
const KEY = "istart-publishing-device-v1";
/** Vault-scoped device storage, deliberately separate from plugin data.json/config sync. */
export class PublishingDeviceConfig {
  readonly value: PublishingDevice;
  private sessionTokens = { local: "", remote: "" };
  constructor(private app: App) {
    const raw: unknown = requireApiVersion("1.8.7") && typeof app.loadLocalStorage === "function" ? app.loadLocalStorage(KEY) : null;
    const saved = raw && typeof raw === "object" ? raw as Partial<PublishingDevice> : {};
    this.value = {
      id: typeof saved.id === "string" && /^[a-f\d-]{36}$/.test(saved.id) ? saved.id : crypto.randomUUID(),
      mode: saved.mode === "local" ? "local" : "remote",
      url: typeof saved.url === "string" ? saved.url : "",
      port: Number.isInteger(saved.port) && saved.port! > 1024 && saved.port! < 65535 ? saved.port! : 27123,
    };
  }
  save(): void { if (requireApiVersion("1.8.7") && typeof this.app.saveLocalStorage === "function") this.app.saveLocalStorage(KEY, this.value); }
  get token(): string {
    if (requireApiVersion("1.11.4") && this.app.secretStorage) return this.app.secretStorage.getSecret(`istart-publishing-${this.value.id}-${this.value.mode}`) ?? this.sessionTokens[this.value.mode];
    return this.sessionTokens[this.value.mode];
  }
  set token(value: string) {
    this.sessionTokens[this.value.mode] = value;
    if (requireApiVersion("1.11.4") && this.app.secretStorage) this.app.secretStorage.setSecret(`istart-publishing-${this.value.id}-${this.value.mode}`, value);
  }
  get hasPersistentSecrets(): boolean { return requireApiVersion("1.11.4") && !!this.app.secretStorage; }
}
