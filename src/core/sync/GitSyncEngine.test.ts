import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { GitSyncEngine, GitTransport, GitResolution } from "./GitSyncEngine";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const directories: string[] = [];

afterEach(async () => { await Promise.all(directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true }))); });

async function device(): Promise<GitSyncEngine> {
  const dir = await fs.mkdtemp(join(tmpdir(), "istart-git-test-"));
  directories.push(dir);
  const engine = new GitSyncEngine({ promises: fs }, dir);
  await engine.initialize();
  return engine;
}

class Cloud implements GitTransport {
  readonly bundles = new Map<string, Uint8Array>();
  async list() { return [...this.bundles.keys()]; }
  async download(oid: string) {
    const bytes = this.bundles.get(oid);
    if (!bytes) throw new Error("Download failed");
    return bytes;
  }
  async upload(oid: string, bytes: Uint8Array) { this.bundles.set(oid, bytes); }
}

const notes = (content: Record<string, string>) => new Map(Object.entries(content).map(([path, text]) => [path, encoder.encode(text)]));
async function contents(engine: GitSyncEngine): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [path, oid] of await engine.files(await engine.head())) result[path] = decoder.decode(await engine.blob(oid));
  return result;
}
async function sync(engine: GitSyncEngine, cloud: GitTransport, choices?: Map<string, GitResolution>) {
  const result = await engine.synchronize(cloud, choices);
  if (!result.conflicts.length) await engine.setHead(result.after);
  return result;
}

describe("Git sync across independent devices", () => {
  it("shares an empty ancestor and preserves notes from both first-time devices", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    expect(await a.head()).toBe(await b.head());
    await a.snapshot(notes({ "电脑.md": "A" }));
    await b.snapshot(notes({ "手机.md": "B" }));
    await sync(a, cloud); await sync(b, cloud); await sync(a, cloud);
    expect(await contents(a)).toEqual({ "电脑.md": "A", "手机.md": "B" });
    expect(await contents(b)).toEqual(await contents(a));
  });

  it("preserves existing special-character filenames through bundles and history", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    const path = "Knowledge/Concepts/_未分类/**体系结构模型**.md";
    const original = {
      [path]: "original",
      'Notes/问题? <标题> | "引用".md': "punctuation",
      "Notes/CON.md": "reserved only on Windows",
      "Notes/trailing.": "trailing dot",
      "Notes/trailing ": "trailing space",
      "Notes/topic:name.md": "colon",
    };
    await a.snapshot(notes(original));
    const first = await a.head();
    await sync(a, cloud); await sync(b, cloud);
    expect(await contents(b)).toEqual(original);
    await b.snapshot(notes({ ...original, [path]: "updated" }));
    await sync(b, cloud); await sync(a, cloud);
    expect((await contents(a))[path]).toBe("updated");
    expect(decoder.decode(await a.restoreFile(path, first))).toBe("original");
  });

  it("merges non-overlapping offline Markdown edits and converges", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    await a.snapshot(notes({ "笔记.md": "标题\n第一段\n间隔\n第二段\n" }));
    await sync(a, cloud); await sync(b, cloud);
    await a.snapshot(notes({ "笔记.md": "新标题\n第一段\n间隔\n第二段\n" }));
    await b.snapshot(notes({ "笔记.md": "标题\n第一段\n间隔\n手机修改\n" }));
    await sync(a, cloud);
    expect((await sync(b, cloud)).conflicts).toEqual([]);
    await sync(a, cloud);
    expect((await contents(a))["笔记.md"]).toBe("新标题\n第一段\n间隔\n手机修改\n");
    expect(await contents(b)).toEqual(await contents(a));
  });

  it("blocks overlapping edits without moving HEAD and supports manual resolution", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    await a.snapshot(notes({ "note.md": "original\n" }));
    await sync(a, cloud); await sync(b, cloud);
    await a.snapshot(notes({ "note.md": "computer\n" }));
    await b.snapshot(notes({ "note.md": "phone\n" }));
    await sync(a, cloud);
    const before = await b.head();
    const result = await sync(b, cloud);
    expect(result.conflicts).toHaveLength(1);
    expect(await b.head()).toBe(before);
    expect(result.conflicts[0]).toMatchObject({ path: "note.md", local: "phone\n", remote: "computer\n" });
    const choices = new Map<string, GitResolution>([[result.conflicts[0].key, { choice: "text", text: "resolved\n" }]]);
    expect((await sync(b, cloud, choices)).conflicts).toEqual([]);
    await sync(a, cloud);
    expect((await contents(a))["note.md"]).toBe("resolved\n");
  });

  it("propagates deletion, but requires a choice for deletion versus modification", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    await a.snapshot(notes({ "note.md": "original" }));
    await sync(a, cloud); await sync(b, cloud);
    await a.snapshot(notes({})); await sync(a, cloud);
    await b.snapshot(notes({ "note.md": "modified" }));
    const modifiedVersion = await b.head();
    const conflict = (await sync(b, cloud)).conflicts[0];
    expect(conflict.remote).toBeUndefined();
    await sync(b, cloud, new Map([[conflict.key, { choice: "remote" }]]));
    expect(await contents(b)).toEqual({});
    expect(decoder.decode(await b.restoreFile("note.md", modifiedVersion))).toBe("modified");
  });

  it("treats binary attachments as conflicts and preserves their bytes", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    await a.snapshot(new Map([["image.png", new Uint8Array([0, 1, 2])]]));
    await sync(a, cloud); await sync(b, cloud);
    await a.snapshot(new Map([["image.png", new Uint8Array([0, 3, 4])]]));
    await b.snapshot(new Map([["image.png", new Uint8Array([0, 5, 6])]]));
    await sync(a, cloud);
    const conflict = (await sync(b, cloud)).conflicts[0];
    expect(conflict.binary).toBe(true);
    await sync(b, cloud, new Map([[conflict.key, { choice: "local" }]]));
    const oid = (await b.files(await b.head())).get("image.png")!;
    expect(await b.blob(oid)).toEqual(new Uint8Array([0, 5, 6]));
  });

  it("keeps concurrently published device bundles and later converges", async () => {
    const a = await device(), b = await device(), cloud = new Cloud();
    await a.snapshot(notes({ "a.md": "a" })); await b.snapshot(notes({ "b.md": "b" }));
    const first = await Promise.all([sync(a, cloud), sync(b, cloud)]);
    expect(first.every((result) => result.uploaded === 1)).toBe(true);
    expect(cloud.bundles.size).toBe(2);
    await sync(a, cloud); await sync(b, cloud);
    expect(await contents(a)).toEqual(await contents(b));
  });

  it("does not publish when the directory listing fails", async () => {
    const a = await device();
    await a.snapshot(notes({ "note.md": "retained" }));
    let uploaded = false;
    await expect(sync(a, {
      list: async () => { throw new Error("Network offline"); },
      download: async () => new Uint8Array(),
      upload: async () => { uploaded = true; },
    })).rejects.toThrow("Network offline");
    expect(uploaded).toBe(false);
    expect((await contents(a))["note.md"]).toBe("retained");
  });

  it("rejects missing incremental prerequisites and corrupted packfiles", async () => {
    const a = await device(), b = await device();
    await a.snapshot(notes({ "note.md": "first" }));
    const first = await a.head();
    await a.snapshot(notes({ "note.md": "second" }));
    const second = await a.head();
    const incremental = await a.bundle(second, first);
    expect(await b.importBundle(incremental, second)).toBe(false);
    await expect(b.pull({
      list: async () => [second], download: async () => incremental, upload: async () => undefined,
    })).rejects.toThrow("缺少前置版本");
    const corrupted = await a.bundle(second);
    corrupted[corrupted.length - 1] ^= 255;
    await expect(b.importBundle(corrupted, second)).rejects.toThrow();
  });

  it("exports full and incremental bundles readable by native Git", async () => {
    const a = await device(), b = await device();
    await a.snapshot(notes({ "note.md": "first" }));
    const first = await a.head();
    const full = join(a.dir, "full.bundle");
    await fs.writeFile(full, await a.bundle(first));
    execFileSync("git", ["--git-dir", join(a.dir, "repo"), "bundle", "verify", full], { stdio: "pipe" });
    const clone = join(b.dir, "clone");
    execFileSync("git", ["clone", full, clone], { stdio: "pipe" });
    await a.snapshot(notes({ "note.md": "second" }));
    const incremental = join(a.dir, "incremental.bundle");
    await fs.writeFile(incremental, await a.bundle(await a.head(), first));
    execFileSync("git", ["bundle", "verify", incremental], { cwd: clone, stdio: "pipe" });
    execFileSync("git", ["fetch", incremental, "main"], { cwd: clone, stdio: "pipe" });
    expect(execFileSync("git", ["show", "FETCH_HEAD:note.md"], { cwd: clone, encoding: "utf8" })).toBe("second");
  });

  it("protects ignored tracked paths and rejects unsafe or colliding names", async () => {
    const a = await device();
    await a.snapshot(notes({ "keep.md": "kept", "delete.md": "deleted" }));
    await a.snapshot(notes({}), new Set(["keep.md"]));
    expect(await contents(a)).toEqual({ "keep.md": "kept" });
    const before = await a.head();
    for (const path of ["../escape.md", "folder/../escape.md", "/absolute.md", "folder//note.md",
      "folder\\note.md", ".obsidian/data.json", "folder/.git/config", "null\0.md"]) {
      await expect(a.snapshot(notes({ [path]: "bad" }))).rejects.toThrow("不支持");
      expect(await a.head()).toBe(before);
    }
    await expect(a.snapshot(notes({ "Foo.md": "a", "foo.md": "b" }))).rejects.toThrow("大小写");
  });
});
