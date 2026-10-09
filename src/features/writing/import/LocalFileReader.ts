/**
 * 本地磁盘文件读取(仅桌面端)。
 *
 * Obsidian 桌面端插件运行在 Electron 渲染进程,可直接 require Node 内置模块。
 * 移动端没有 require,返回 null,由调用方降级提示。
 */

interface FsModule {
  existsSync(path: string): boolean;
  statSync(path: string): { isFile(): boolean; isDirectory(): boolean };
  readFileSync(path: string, encoding: "utf-8"): string;
  readdirSync(path: string): string[];
}

declare function require(id: string): unknown;

let cached: FsModule | null | undefined;

export function getFs(): FsModule | null {
  if (cached !== undefined) return cached;
  try {
    const req = (typeof require !== "undefined" ? require : null) as ((id: string) => unknown) | null;
    cached = req ? (req("fs") as FsModule) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function isDesktop(): boolean {
  return getFs() !== null;
}

/** 读取磁盘上的单个文本文件(UTF-8) */
export function readLocalFile(path: string): string | null {
  const fs = getFs();
  if (!fs) return null;
  if (!fs.existsSync(path)) return null;
  if (!fs.statSync(path).isFile()) return null;
  return fs.readFileSync(path, "utf-8");
}

/** 列出磁盘目录下的 .md/.txt 文件(按名称排序) */
export function listLocalManuscriptFiles(dir: string): string[] {
  const fs = getFs();
  if (!fs || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.(md|txt)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function fileExtensionOf(path: string): string {
  const m = path.match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : "";
}

export function basenameOf(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
