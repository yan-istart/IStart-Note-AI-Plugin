import type { DataAdapter } from "obsidian";
import type { PromiseFsClient } from "isomorphic-git";

function fsError(code: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

export async function ensureDirectory(adapter: DataAdapter, path: string): Promise<void> {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
  }
}

/** Promise filesystem backed by the same Obsidian adapter on iOS, Android, and desktop. */
export class ObsidianGitFs implements PromiseFsClient {
  readonly promises: PromiseFsClient["promises"];

  constructor(private readonly adapter: DataAdapter, private readonly root: string) {
    const stat = async (path: string) => {
      const entry = await adapter.stat(this.path(path));
      if (!entry) throw fsError("ENOENT", path);
      return {
        type: entry.type, size: entry.size, mtimeMs: entry.mtime, ctimeMs: entry.ctime,
        mtime: new Date(entry.mtime), ctime: new Date(entry.ctime),
        mode: entry.type === "folder" ? 0o40755 : 0o100644, uid: 0, gid: 0, dev: 0, ino: 0,
        isFile: () => entry.type === "file", isDirectory: () => entry.type === "folder", isSymbolicLink: () => false,
      };
    };
    this.promises = {
      readFile: async (path: string, options?: string | { encoding?: string }) => {
        const real = this.path(path);
        if (!(await adapter.exists(real))) throw fsError("ENOENT", path);
        const encoding = typeof options === "string" ? options : options?.encoding;
        return encoding ? adapter.read(real) : new Uint8Array(await adapter.readBinary(real));
      },
      writeFile: async (path: string, data: string | Uint8Array) => {
        const real = this.path(path);
        await ensureDirectory(adapter, real.slice(0, real.lastIndexOf("/")));
        if (typeof data === "string") await adapter.write(real, data);
        // Buffer.slice() is a view, unlike Uint8Array.slice(); copy the exact bytes.
        else await adapter.writeBinary(real, Uint8Array.from(data).buffer as ArrayBuffer);
      },
      unlink: async (path: string) => {
        const real = this.path(path);
        if (!(await adapter.exists(real))) throw fsError("ENOENT", path);
        await adapter.remove(real);
      },
      readdir: async (path: string) => {
        const real = this.path(path);
        if (!(await adapter.exists(real))) throw fsError("ENOENT", path);
        const entries = await adapter.list(real);
        return [...entries.files, ...entries.folders].map((p) => p.slice(real.length + 1));
      },
      mkdir: async (path: string) => {
        const real = this.path(path);
        if (await adapter.exists(real)) throw fsError("EEXIST", path);
        await ensureDirectory(adapter, real);
      },
      rmdir: async (path: string) => {
        const real = this.path(path);
        if (!(await adapter.exists(real))) throw fsError("ENOENT", path);
        await adapter.rmdir(real, false);
      },
      stat, lstat: stat,
      readlink: async (path: string) => { throw fsError("EINVAL", path); },
      symlink: async (_target: string, path: string) => { throw fsError("ENOTSUP", path); },
      chmod: async () => undefined,
    };
  }

  private path(path: string): string {
    const parts = path.split("/").filter((part) => part && part !== ".");
    if (parts[0] !== "git" || parts.some((part) => part === ".." || part.includes("\\") || part.includes("\0"))) {
      throw fsError("EACCES", path);
    }
    return [this.root, ...parts.slice(1)].join("/");
  }
}
