export class TFile {
  path = "";
  stat = { size: 0, mtime: 0, ctime: 0 };
}

export class Notice {
  setMessage() {}
  hide() {}
}

export async function requestUrl(): Promise<never> { throw new Error("Unexpected real network request in tests"); }
