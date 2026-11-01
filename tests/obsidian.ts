export class TFile {
  path = "";
  stat = { size: 0, mtime: 0, ctime: 0 };
}

export const Platform = { isWin: false };

export class Notice {
  setMessage() {}
  hide() {}
}

export class MarkdownView {}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export async function requestUrl(): Promise<never> { throw new Error("Unexpected real network request in tests"); }
