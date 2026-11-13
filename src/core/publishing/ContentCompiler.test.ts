import { describe, it, expect, vi } from "vitest";
import { compileArticle } from "./ContentCompiler";
import { loadPublishingSettings, publishingFolder, sanitizeRemoteUrl } from "./types";
import { serviceUrl, parseJob } from "./PublishingClient";

describe("publishing content", () => {
  it("freezes local images, deduplicates attachments and removes private annotations while preserving prose", async () => {
    const read = vi.fn(async () => ({ path: "Attachments/猫.png", data: new Uint8Array([1, 2, 3]).buffer }));
    const result = await compileArticle('---\nprivate: secret\n---\n# 标题\n\n==正文==^[内部意见] %%私密%% [[笔记|显示文字]]\n![[猫.png|200]]\n![猫](Attachments/%E7%8C%AB.png)', "fallback", read);
    expect(result.title).toBe("标题");
    expect(result.markdown).toContain("正文");
    expect(result.markdown).toContain("显示文字");
    expect(result.markdown).not.toMatch(/私密|内部意见|private|\[\[/);
    expect(result.assets).toHaveLength(1);
    expect(result.markdown.match(/assets\/image-1.png/g)).toHaveLength(2);
  });
  it("preserves fenced and inline code, standard footnotes and code headings", async () => {
    const source = '```md\n# 示例\n![[not-an-image]]\n%%literal%%\n```\n\n# 正文标题\n\n正文[^1]，`[[literal]]`\n\n[^1]: 文献引用';
    const result = await compileArticle(source, "fallback", async () => { throw new Error("must not read code"); });
    expect(result.title).toBe("正文标题");
    expect(result.markdown).toContain("# 示例");
    expect(result.markdown).toContain("%%literal%%");
    expect(result.markdown).toContain("`[[literal]]`");
    expect(result.markdown).toContain("[^1]: 文献引用");
  });
  it("blocks missing or unsupported embeds and preserves remote images", async () => {
    await expect(compileArticle("# 标题\n![[missing.png]]", "x", async () => null)).rejects.toThrow("找不到图片");
    await expect(compileArticle("# 标题\n![[note.md]]", "x", async () => ({ path: "note.md", data: new ArrayBuffer(1) }))).rejects.toThrow("不支持");
    await expect(compileArticle("# 标题\n![image][ref]", "x", async () => null)).rejects.toThrow("引用式");
    expect((await compileArticle("# 标题\n![外链](https://example.com/a.png)", "x", async () => null)).markdown).toContain("https://example.com/a.png");
  });
  it("rejects oversized assets before submission", async () => {
    await expect(compileArticle("# t\n![[big.png]]", "x", async () => ({ path: "big.png", data: new ArrayBuffer(8 * 1024 * 1024 + 1) }))).rejects.toThrow("8 MB");
  });
  it("keeps drafts inside visible vault folders and strips credentials from returned URLs", () => {
    expect(loadPublishingSettings({ folder: "../escape" }).folder).toBe("IStart/Publishing");
    expect(() => publishingFolder(".obsidian/publish")).toThrow();
    expect(sanitizeRemoteUrl("https://mp.weixin.qq.com/edit?appmsgid=1&token=secret&ticket=x")).toBe("https://mp.weixin.qq.com/edit?appmsgid=1");
    expect(sanitizeRemoteUrl("javascript:alert(1)")).toBeUndefined();
    expect(serviceUrl("http://127.0.0.1:27123/")).toBe("http://127.0.0.1:27123");
    expect(() => serviceUrl("http://192.168.1.2:27123")).toThrow("HTTPS");
    expect(() => serviceUrl("https://host/?token=secret")).toThrow();
    expect(() => parseJob({ id: "../path" })).toThrow();
  });
});
