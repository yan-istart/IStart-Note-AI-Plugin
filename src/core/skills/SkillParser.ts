import type { SkillApply, SkillDefinition, SkillScope } from "./types";

interface ParsedFrontmatter {
  name: string;
  description: string;
  metadata: Record<string, string>;
}

const SCOPES: SkillScope[] = ["global", "genre", "project"];
const APPLIES: SkillApply[] = ["writing", "all"];

/** Parse a standard Agent Skills markdown file into the plugin's skill model. */
export function parseSkillMarkdown(
  content: string,
  id: string,
  path: string,
  root: string
): SkillDefinition | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return null;

  const frontmatter = parseFrontmatter(match[1]);
  const name = frontmatter.name || id;
  const description = frontmatter.description;
  const body = content.slice(match[0].length).trim();
  if (!description || !body) return null;

  const meta = frontmatter.metadata;
  const rawScope = normalizeKey(readMetadata(meta, "scope"));
  const scope: SkillScope = SCOPES.includes(rawScope as SkillScope) ? rawScope as SkillScope : "global";
  const rawApply = normalizeKey(readMetadata(meta, "apply"));
  const apply: SkillApply = APPLIES.includes(rawApply as SkillApply) ? rawApply as SkillApply : "writing";
  const rawGenre = readMetadata(meta, "genre").trim();
  const genre = rawGenre && rawGenre.toLowerCase() !== "any" ? rawGenre : undefined;
  const project = readMetadata(meta, "project").trim() || undefined;
  const projectPath = normalizePathValue(readMetadata(meta, "project-path") || readMetadata(meta, "projectPath"));
  const priority = parsePriority(readMetadata(meta, "priority"), scope);

  return {
    id,
    name,
    description,
    body,
    scope,
    apply,
    genre,
    project,
    projectPath: projectPath || undefined,
    priority,
    path,
    root,
  };
}

function parseFrontmatter(source: string): ParsedFrontmatter {
  const top: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;

  for (const rawLine of source.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indented = /^\s+/.test(rawLine);
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (!indented) {
      inMetadata = key === "metadata";
      if (!inMetadata) top[key] = unquote(value);
      continue;
    }
    if (inMetadata) metadata[key] = unquote(value);
  }

  return {
    name: top.name ?? "",
    description: top.description ?? "",
    metadata,
  };
}

function readMetadata(metadata: Record<string, string>, key: string): string {
  const normalized = normalizeKey(key);
  for (const [rawKey, value] of Object.entries(metadata)) {
    if (normalizeKey(rawKey) === normalized) return value;
  }
  return "";
}

/** Accept keys such as istart/scope, istart.scope and istart-scope. */
function normalizeKey(key: string): string {
  return key
    .trim()
    .replace(/^istart[/.-]/i, "")
    .replace(/[/.]/g, "-")
    .toLowerCase();
}

function parsePriority(value: string, scope: SkillScope): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) return parsed;
  return scope === "project" ? 30 : scope === "genre" ? 20 : 10;
}

function normalizePathValue(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
