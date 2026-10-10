import * as git from "isomorphic-git";
import diff3 from "diff3";

export interface GitTransport {
  list(): Promise<string[]>;
  download(oid: string): Promise<Uint8Array>;
  upload(oid: string, bundle: Uint8Array): Promise<void>;
}

export interface GitConflict {
  path: string;
  key: string;
  local?: string;
  remote?: string;
  base?: string;
  binary: boolean;
}

export type GitResolution = { choice: "local" | "remote" } | { choice: "text"; text: string };
export interface GitSyncOutcome {
  before: string;
  after: string;
  uploaded: number;
  downloaded: number;
  conflicts: GitConflict[];
}

export interface GitHistoryEntry {
  oid: string;
  message: string;
  timestamp: number;
}

export interface GitVersionFile {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
}

export interface GitVersionDetails {
  oid: string;
  files: GitVersionFile[];
  total: number;
  added: number;
  modified: number;
  deleted: number;
}

const OID = /^[0-9a-f]{40}$/;
const REF = "refs/heads/main";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function assertNotePath(path: string): void {
  // Validate vault-relative paths, not Windows filename rules. Git trees retain
  // existing names verbatim; the vault service checks the destination platform.
  if (!path || path.includes("\\") || /[\x00-\x1f]/.test(path) || path.split("/").some(
    (part) => !part || part.startsWith(".")
  )) throw new Error(`不支持的同步路径：${path}`);
}

export function textOf(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try { return decoder.decode(bytes); } catch { return undefined; }
}

function sameTree(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([path, oid]) => b.get(path) === oid);
}

/** Git objects only: no shell, Node filesystem, or checkout into the live vault. */
export class GitSyncEngine {
  private readonly args: { fs: git.FsClient; dir: string; gitdir: string };

  constructor(private readonly fs: git.PromiseFsClient, readonly dir: string) {
    this.args = { fs, dir, gitdir: `${dir}/repo` };
  }

  async initialize(): Promise<void> {
    await git.init({ ...this.args, defaultBranch: "main", bare: true });
    let exists = true;
    try { await this.fs.promises.readFile(`${this.args.gitdir}/${REF}`); }
    catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      exists = false;
    }
    if (!exists) {
      const tree = await git.writeTree({ ...this.args, tree: [] });
      // Every independently initialized device shares this exact ancestor.
      const person = { name: "IStart Sync", email: "sync@istart.local", timestamp: 1, timezoneOffset: 0 };
      const root = await git.writeCommit({ ...this.args, commit: {
        tree, parent: [], author: person, committer: person, message: "IStart Git Sync v1\n",
      } });
      await this.setHead(root);
    } else await git.readCommit({ ...this.args, oid: await this.head() });
  }

  head(): Promise<string> { return git.resolveRef({ ...this.args, ref: REF }); }

  async setHead(oid: string): Promise<void> {
    await git.readCommit({ ...this.args, oid });
    await git.writeRef({ ...this.args, ref: REF, value: oid, force: true });
  }

  async files(ref: string): Promise<Map<string, string>> {
    const { commit } = await git.readCommit({ ...this.args, oid: ref });
    const files = new Map<string, string>();
    const walk = async (oid: string, prefix: string): Promise<void> => {
      const { tree } = await git.readTree({ ...this.args, oid });
      for (const entry of tree) {
        const path = prefix + entry.path;
        assertNotePath(path);
        if (entry.type === "tree") await walk(entry.oid, path + "/");
        else if (entry.type === "blob" && entry.mode === "100644") files.set(path, entry.oid);
        else throw new Error(`同步版本包含不支持的文件：${path}`);
      }
    };
    await walk(commit.tree, "");
    this.assertPortablePaths(files);
    return files;
  }

  async blob(oid: string): Promise<Uint8Array> {
    return (await git.readBlob({ ...this.args, oid })).blob;
  }

  async snapshot(files: Iterable<readonly [string, Uint8Array]> | AsyncIterable<readonly [string, Uint8Array]>, protectedPaths = new Set<string>()): Promise<string> {
    const parent = await this.head();
    const previous = await this.files(parent);
    const next = new Map([...previous].filter(([path]) => protectedPaths.has(path)));
    for await (const [path, blob] of files) {
      assertNotePath(path);
      const { oid } = await git.hashBlob({ object: blob });
      next.set(path, oid === previous.get(path) ? oid : await git.writeBlob({ ...this.args, blob }));
    }
    if (sameTree(previous, next)) return parent;
    const oid = await this.commit(next, [parent], "保存本地修改");
    await this.setHead(oid);
    return oid;
  }

  private assertPortablePaths(files: Map<string, string>): void {
    const seen = new Set<string>();
    const spellings = new Map<string, string>();
    for (const path of files.keys()) {
      const key = path.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new Error(`文件名仅大小写或 Unicode 形式不同，无法跨设备同步：${path}`);
      seen.add(key);
      const parts = path.split("/");
      for (let length = 1; length <= parts.length; length++) {
        const spelling = parts.slice(0, length).join("/");
        const folded = spelling.normalize("NFC").toLowerCase();
        if (spellings.has(folded) && spellings.get(folded) !== spelling) {
          throw new Error(`文件或目录名称仅大小写或 Unicode 形式不同：${spelling}`);
        }
        spellings.set(folded, spelling);
      }
    }
    for (const path of seen) {
      const parts = path.split("/");
      while (parts.length > 1) {
        parts.pop();
        if (seen.has(parts.join("/"))) throw new Error(`文件与目录名称冲突：${path}`);
      }
    }
  }

  private async commit(files: Map<string, string>, parents: string[], message: string): Promise<string> {
    this.assertPortablePaths(files);
    const write = async (prefix: string): Promise<string> => {
      const entries: git.TreeEntry[] = [];
      const folders = new Set<string>();
      for (const [path, oid] of files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) entries.push({ path: rest, oid, mode: "100644", type: "blob" });
        else folders.add(rest.slice(0, slash));
      }
      for (const folder of folders) entries.push({
        path: folder, oid: await write(prefix + folder + "/"), mode: "040000", type: "tree",
      });
      return git.writeTree({ ...this.args, tree: entries });
    };
    const person = { name: "IStart Sync", email: "sync@istart.local", timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
    return git.writeCommit({ ...this.args, commit: {
      tree: await write(""), parent: parents, author: person, committer: person, message: message + "\n",
    } });
  }

  private async reachable(head: string): Promise<Set<string>> {
    const seen = new Set<string>();
    const visit = async (oid: string): Promise<void> => {
      if (seen.has(oid)) return;
      seen.add(oid);
      const object = await git.readObject({ ...this.args, oid, format: "content" });
      if (object.type === "commit") {
        const { commit } = await git.readCommit({ ...this.args, oid });
        await visit(commit.tree);
        for (const parent of commit.parent) await visit(parent);
      } else if (object.type === "tree") {
        const { tree } = await git.readTree({ ...this.args, oid });
        for (const entry of tree) await visit(entry.oid);
      } else if (object.type !== "blob") throw new Error("同步包包含不支持的 Git 对象");
    };
    await visit(head);
    return seen;
  }

  async bundle(head: string, base?: string): Promise<Uint8Array> {
    const objects = await this.reachable(head);
    if (base) for (const oid of await this.reachable(base)) objects.delete(oid);
    const { packfile } = await git.packObjects({ ...this.args, oids: [...objects] });
    if (!packfile) throw new Error("无法生成 Git 同步包");
    const header = encoder.encode(`# v2 git bundle\n${base ? `-${base} prerequisite\n` : ""}${head} ${REF}\n\n`);
    const bytes = new Uint8Array(header.length + packfile.length);
    bytes.set(header); bytes.set(packfile, header.length);
    return bytes;
  }

  private parseBundle(bytes: Uint8Array, expected: string): { head: string; base?: string; pack: Uint8Array } {
    let end = -1;
    for (let i = 0; i < Math.min(bytes.length - 1, 4096); i++) {
      if (bytes[i] === 10 && bytes[i + 1] === 10) { end = i + 2; break; }
    }
    if (end < 0) throw new Error("Git 同步包缺少有效头部");
    const lines = decoder.decode(bytes.slice(0, end)).trimEnd().split("\n");
    if (lines.shift() !== "# v2 git bundle") throw new Error("不支持的 Git 同步包格式");
    let base: string | undefined;
    if (lines[0]?.startsWith("-")) {
      base = lines.shift()!.slice(1, 41);
      if (!OID.test(base)) throw new Error("Git 同步包依赖无效");
    }
    if (lines.length !== 1 || lines[0] !== `${expected} ${REF}` || !OID.test(expected)) {
      throw new Error("Git 同步包版本与文件名不一致");
    }
    const pack = bytes.slice(end);
    if (pack.length < 32 || decoder.decode(pack.slice(0, 4)) !== "PACK") throw new Error("Git 同步包内容无效");
    return { head: expected, base, pack };
  }

  async importBundle(bytes: Uint8Array, expected: string): Promise<boolean> {
    const { head, base, pack } = this.parseBundle(bytes, expected);
    if (base && !(await this.hasCommit(base))) return false;
    const checksum = [...pack.slice(-20)].map((n) => n.toString(16).padStart(2, "0")).join("");
    const relative = `repo/objects/pack/pack-${checksum}.pack`;
    try { await this.fs.promises.mkdir(`${this.dir}/repo/objects/pack`); }
    catch (error) { if ((error as { code?: string }).code !== "EEXIST") throw error; }
    await this.fs.promises.writeFile(`${this.dir}/${relative}`, pack);
    await git.indexPack({ ...this.args, filepath: relative });
    // Validate the complete commit closure before advertising it as received.
    await this.reachable(head);
    await this.files(head);
    await git.writeRef({ ...this.args, ref: `refs/remotes/baidu/${head}`, value: head, force: true });
    return true;
  }

  private async hasCommit(oid: string): Promise<boolean> {
    try { await git.readCommit({ ...this.args, oid }); return true; } catch { return false; }
  }

  async pull(transport: GitTransport): Promise<{ heads: string[]; downloaded: number }> {
    const heads = [...new Set(await transport.list())].sort();
    if (heads.some((oid) => !OID.test(oid))) throw new Error("云端版本列表无效");
    const pending = new Map<string, Uint8Array>();
    for (const head of heads) {
      try { await git.resolveRef({ ...this.args, ref: `refs/remotes/baidu/${head}` }); }
      catch { pending.set(head, await transport.download(head)); }
    }
    const downloaded = pending.size;
    while (pending.size) {
      let progress = false;
      for (const [head, bytes] of pending) {
        if (await this.importBundle(bytes, head)) { pending.delete(head); progress = true; }
      }
      if (!progress) throw new Error("云端增量包缺少前置版本，请恢复缺失的版本包后重试");
    }
    return { heads, downloaded };
  }

  private async ancestor(oid: string, ancestor: string): Promise<boolean> {
    return oid === ancestor || git.isDescendent({ ...this.args, oid, ancestor });
  }

  async merge(ours: string, theirs: string, resolutions: Map<string, GitResolution>): Promise<{ oid: string; conflicts: GitConflict[] }> {
    if (await this.ancestor(ours, theirs)) return { oid: ours, conflicts: [] };
    if (await this.ancestor(theirs, ours)) return { oid: theirs, conflicts: [] };
    const local = await this.files(ours);
    const remote = await this.files(theirs);
    if (sameTree(local, remote)) return { oid: await this.commit(local, [ours, theirs], "合并设备修改"), conflicts: [] };
    const bases = await git.findMergeBase({ ...this.args, oids: [ours, theirs] });
    if (bases.length !== 1) throw new Error("版本历史缺少唯一共同祖先，无法安全自动合并");
    const base = await this.files(bases[0]);
    const merged = new Map<string, string>();
    const conflicts: GitConflict[] = [];
    for (const path of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
      const b = base.get(path), l = local.get(path), r = remote.get(path);
      let result: string | undefined;
      if (l === r) result = l;
      else if (l === b) result = r;
      else if (r === b) result = l;
      else {
        const key = `${path}:${b ?? "-"}:${l ?? "-"}:${r ?? "-"}`;
        const resolution = resolutions.get(key);
        const read = async (oid?: string): Promise<string | undefined> => oid ? textOf(await this.blob(oid)) : undefined;
        const [baseText, localText, remoteText] = await Promise.all([read(b), read(l), read(r)]);
        const binary = !/\.(md|markdown|txt|canvas|json|csv|tsv|yaml|yml)$/i.test(path)
          || (l !== undefined && localText === undefined) || (r !== undefined && remoteText === undefined)
          || (b !== undefined && baseText === undefined)
          || [baseText, localText, remoteText].some((text) => (text?.length ?? 0) > 1_000_000);
        if (resolution?.choice === "local") result = l;
        else if (resolution?.choice === "remote") result = r;
        else if (resolution?.choice === "text" && !binary) result = await git.writeBlob({ ...this.args, blob: encoder.encode(resolution.text) });
        else if (!binary && l !== undefined && r !== undefined && b !== undefined) {
          const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
          const blocks = diff3(lines(localText!), lines(baseText!), lines(remoteText!));
          if (blocks.every((block) => "ok" in block)) {
            const text = blocks.map((block) => "ok" in block ? block.ok.join("") : "").join("");
            result = await git.writeBlob({ ...this.args, blob: encoder.encode(text) });
          } else conflicts.push({ path, key, base: baseText, local: localText, remote: remoteText, binary });
        } else conflicts.push({ path, key, base: baseText, local: localText, remote: remoteText, binary });
      }
      if (result) merged.set(path, result);
    }
    if (conflicts.length) return { oid: ours, conflicts };
    return { oid: await this.commit(merged, [ours, theirs], "合并设备修改"), conflicts: [] };
  }

  async synchronize(transport: GitTransport, resolutions = new Map<string, GitResolution>(), recoveryHead?: string): Promise<GitSyncOutcome> {
    const before = await this.head();
    const { heads, downloaded } = await this.pull(transport);
    let after = before;
    for (const remote of new Set([...(recoveryHead ? [recoveryHead] : []), ...heads])) {
      const merged = await this.merge(after, remote, resolutions);
      if (merged.conflicts.length) return { before, after: before, uploaded: 0, downloaded, conflicts: merged.conflicts };
      after = merged.oid;
    }
    let uploaded = 0;
    if (!heads.includes(after)) {
      const history = await git.log({ ...this.args, ref: after });
      const base = history.find((entry) => heads.includes(entry.oid))?.oid;
      await transport.upload(after, await this.bundle(after, base));
      uploaded = 1;
    }
    // The live-vault layer advances HEAD only after a durable application journal.
    return { before, after, uploaded, downloaded, conflicts: [] };
  }

  async history(depth = 30): Promise<GitHistoryEntry[]> {
    const entries = await git.log({ ...this.args, ref: await this.head(), depth });
    return entries.filter((entry) => entry.commit.parent.length).map((entry) => ({
      oid: entry.oid, message: entry.commit.message.trim(), timestamp: entry.commit.author.timestamp * 1000,
    }));
  }

  async versionDetails(ref: string, baseRef?: string): Promise<GitVersionDetails> {
    const { commit } = await git.readCommit({ ...this.args, oid: ref });
    const current = await this.files(ref);
    const base = baseRef ?? commit.parent[0];
    const previous = base ? await this.files(base) : new Map<string, string>();
    const files: GitVersionFile[] = [...new Set([...current.keys(), ...previous.keys()])].sort().map((path) => ({
      path,
      status: !current.has(path) ? "deleted" : !previous.has(path) ? "added"
        : current.get(path) === previous.get(path) ? "unchanged" : "modified",
    }));
    return {
      oid: ref, files, total: current.size,
      added: files.filter((file) => file.status === "added").length,
      modified: files.filter((file) => file.status === "modified").length,
      deleted: files.filter((file) => file.status === "deleted").length,
    };
  }

  /** Create a forward commit; the vault service advances HEAD after applying it. */
  async prepareRestore(ref: string, protectedPaths = new Set<string>()): Promise<string> {
    const parent = await this.head();
    const previous = await this.files(parent);
    const target = await this.files(ref);
    for (const path of protectedPaths) {
      const oid = previous.get(path);
      if (oid) target.set(path, oid);
      else target.delete(path);
    }
    if (sameTree(previous, target)) return parent;
    return this.commit(target, [parent], `恢复整个笔记库至 ${ref.slice(0, 8)}`);
  }

  async restoreFile(path: string, ref: string): Promise<Uint8Array> {
    assertNotePath(path);
    const oid = (await this.files(ref)).get(path);
    if (!oid) throw new Error("此版本中不存在该文件");
    return this.blob(oid);
  }
}
