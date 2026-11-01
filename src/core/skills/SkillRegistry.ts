import { App, normalizePath } from "obsidian";
import type { SkillSettings } from "../../types";
import type { SkillDefinition } from "./types";
import { parseSkillMarkdown } from "./SkillParser";

const MAX_FOLDER_DEPTH = 3;

/**
 * Discover standard Agent Skills from configured vault-relative roots.
 * Roots are scanned for `<id>/SKILL.md`, flat `<id>.md`, and nested grouping folders.
 */
export class SkillRegistry {
  private skills: SkillDefinition[] = [];
  private loaded = false;
  private refreshPromise: Promise<SkillDefinition[]> | null = null;

  constructor(private app: App, private getSettings: () => SkillSettings) {}

  /** Cached definitions for synchronous UI rendering. */
  getSkills(): SkillDefinition[] {
    return this.skills;
  }

  async ensureLoaded(): Promise<SkillDefinition[]> {
    if (this.loaded) return this.skills;
    return this.refresh();
  }

  /** Force a rescan after a skill file or vault root changes. */
  invalidate(): void {
    this.loaded = false;
  }

  async refresh(): Promise<SkillDefinition[]> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.scan().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  /** True when a vault path belongs to one of the configured skill roots. */
  isSkillPath(path: string): boolean {
    const normalized = normalizeRoot(path);
    return this.getSettings().roots.some((root) => {
      const candidate = normalizeRoot(root);
      return !!candidate && (normalized === candidate || normalized.startsWith(`${candidate}/`));
    });
  }

  private async scan(): Promise<SkillDefinition[]> {
    const skills = new Map<string, SkillDefinition>();
    const roots = this.getSettings().roots
      .map(normalizeRoot)
      .filter((root, index, all) => !!root && all.indexOf(root) === index);

    for (const root of roots) await this.scanRoot(root, skills);

    this.skills = [...skills.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.loaded = true;
    return this.skills;
  }

  private async scanRoot(root: string, skills: Map<string, SkillDefinition>): Promise<void> {
    let listing: { files: string[]; folders: string[] };
    try {
      listing = await this.app.vault.adapter.list(root);
    } catch {
      return;
    }

    const rootSkill = listing.files.find((file) => baseName(file) === "SKILL.md");
    if (rootSkill) {
      await this.addSkill(rootSkill, root, skills);
      return;
    }

    for (const file of listing.files) {
      if (!file.toLowerCase().endsWith(".md") || baseName(file) === "SKILL.md") continue;
      await this.addSkill(file, root, skills);
    }
    for (const folder of listing.folders) {
      await this.scanFolder(folder, root, 1, skills);
    }
  }

  private async scanFolder(
    folder: string,
    root: string,
    depth: number,
    skills: Map<string, SkillDefinition>
  ): Promise<void> {
    if (depth > MAX_FOLDER_DEPTH || shouldSkipFolder(folder)) return;
    let listing: { files: string[]; folders: string[] };
    try {
      listing = await this.app.vault.adapter.list(folder);
    } catch {
      return;
    }

    const skillFile = listing.files.find((file) => baseName(file) === "SKILL.md");
    if (skillFile) {
      await this.addSkill(skillFile, root, skills);
      return;
    }
    for (const child of listing.folders) {
      await this.scanFolder(child, root, depth + 1, skills);
    }
  }

  private async addSkill(path: string, root: string, skills: Map<string, SkillDefinition>): Promise<void> {
    let content: string;
    try {
      content = await this.app.vault.adapter.read(path);
    } catch {
      return;
    }
    const id = skillId(path);
    if (!id || skills.has(id)) return;
    try {
      const skill = parseSkillMarkdown(content, id, path, root);
      if (skill) skills.set(skill.id, skill);
    } catch {
      // Ignore a malformed skill file; other skills should still load.
    }
  }
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? "";
}

function skillId(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const name = baseName(normalized);
  if (name === "SKILL.md") {
    const parts = normalized.split("/");
    return parts[parts.length - 2] ?? "";
  }
  return name.replace(/\.md$/i, "");
}

function normalizeRoot(root: string): string {
  return normalizePath(root.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
}

function shouldSkipFolder(path: string): boolean {
  const name = baseName(path);
  return !name || name.startsWith(".") || name === "node_modules";
}
