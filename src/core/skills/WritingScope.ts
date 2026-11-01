import { App, TFile, normalizePath } from "obsidian";
import { fmString, frontmatterOf } from "../../util/frontmatter";
import type { WritingScopeInfo } from "./types";

const MAX_PARENT_DEPTH = 6;

/**
 * Find the writing project that owns a file by walking up to `_作品.md`.
 * Used to attach a project-specific Skill automatically.
 */
export async function resolveWritingScope(app: App, file: TFile | null): Promise<WritingScopeInfo | null> {
  if (!file) return null;

  let folder = file.parent?.path ?? "";
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    const candidate = folder ? normalizePath(`${folder}/_作品.md`) : "_作品.md";
    const projectFile = app.vault.getAbstractFileByPath(candidate);
    if (projectFile instanceof TFile) {
      const projectFm = frontmatterOf(app.metadataCache.getFileCache(projectFile));
      const fileFm = frontmatterOf(app.metadataCache.getFileCache(file));
      let title = fmString(projectFm, "title") ?? "";
      let genre = fmString(projectFm, "genre") ?? fmString(fileFm, "genre") ?? "";
      if (!title || !genre) {
        const fallback = await readProjectFrontmatter(app, projectFile);
        title = title || fallback.title;
        genre = genre || fallback.genre;
      }
      return {
        projectTitle: title || projectFile.basename,
        projectPath: folder,
        genre,
      };
    }

    if (!folder) break;
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "";
    if (parent === folder) break;
    folder = parent;
  }
  return null;
}

async function readProjectFrontmatter(app: App, file: TFile): Promise<{ title: string; genre: string }> {
  try {
    const content = await app.vault.cachedRead(file);
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!match) return { title: "", genre: "" };
    const value = (key: string) => {
      const found = new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m").exec(match[1]);
      return found?.[1]?.trim() ?? "";
    };
    return { title: value("title"), genre: value("genre") };
  } catch {
    return { title: "", genre: "" };
  }
}
