import { describe, expect, it, vi } from "vitest";
import type { App, Setting, SettingGroup } from "obsidian";
import type DeepSeekPlugin from "../main";
import { DeepSeekSettingsTab } from "./SettingsTab";

vi.mock("obsidian", () => ({
  PluginSettingTab: class { containerEl = { addClass: vi.fn() }; },
  Setting: class {},
  Notice: class {},
  requireApiVersion: vi.fn(),
}));
vi.mock("../features/sync/BaiduAuthModal", () => ({ BaiduAuthModal: class {} }));

describe("settings search compatibility", () => {
  it("indexes every section and important setting names without touching plugin state or starting scans", () => {
    // No plugin services are available while Obsidian registers search definitions.
    const plugin = new Proxy({}, { get: () => { throw new Error("Search indexing must not access plugin services"); } });
    const tab = new DeepSeekSettingsTab({} as App, plugin as DeepSeekPlugin);
    const pages = tab.getSettingDefinitions();
    expect(pages).toHaveLength(8);
    const aliases = pages.flatMap(page => "type" in page && page.type === "page" ? page.items?.flatMap(item => "aliases" in item ? item.aliases ?? [] : []) ?? [] : []);
    expect(aliases).toEqual(expect.arrayContaining(["API Key", "Base URL", "默认续写字数", "Skill 根目录", "默认批注形式", "移动端启用", "同步方式", "App Secret", "远程服务地址", "本地安装并启动"]));
  });

  it("renders a search result in the matching section only when opened", () => {
    const tab = new DeepSeekSettingsTab({} as App, {} as DeepSeekPlugin);
    const internals = tab as unknown as { activeSection: string; renderSection(el: HTMLElement): void };
    const render = vi.spyOn(internals, "renderSection").mockImplementation(() => {});
    const page = tab.getSettingDefinitions().find(item => "name" in item && item.name === "写作");
    if (!page || !("type" in page) || page.type !== "page") throw new Error("Missing writing settings");
    const row = page.items?.[0];
    if (!row || !("render" in row) || !row.render) throw new Error("Missing section renderer");
    expect(render).not.toHaveBeenCalled();
    const settingEl = { empty: vi.fn(), removeClass: vi.fn() };
    row.render({ settingEl } as unknown as Setting, {} as SettingGroup);
    expect(internals.activeSection).toBe("writing");
    expect(render).toHaveBeenCalledWith(settingEl);
  });
});
