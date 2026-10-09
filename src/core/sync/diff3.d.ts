declare module "diff3" {
  type MergeBlock = { ok: string[] } | { conflict: { a: string[]; o: string[]; b: string[] } };
  export default function merge(ours: string[], base: string[], theirs: string[]): MergeBlock[];
}
