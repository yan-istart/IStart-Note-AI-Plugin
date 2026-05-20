import { App, TFile, CachedMetadata, normalizePath } from "obsidian";

/**
 * A single indexed vault entry.
 * Derived from Obsidian's metadataCache + file stats — no embedding, no external DB.
 */
export interface IndexEntry {
  path: string;
  basename: string;
  title: string;                 // first H1 or basename
  type: string | undefined;      // frontmatter.type
  domain: string | undefined;    // frontmatter.domain
  status: string | undefined;    // frontmatter.status
  tags: string[];
  headings: string[];            // all ## headings
  links: string[];               // outgoing [[links]]
  backlinks: string[];           // populated after full scan
  concepts: string[];            // frontmatter.concepts (for questions)
  mtime: number;
}

export interface SearchResult {
  entry: IndexEntry;
  score: number;
  /** Which matching criteria contributed. */
  matchedOn: ("title" | "tag" | "heading" | "link" | "backlink" | "concept" | "domain" | "keyword")[];
}

export interface SearchOptions {
  /** Max results to return. Default 10. */
  limit?: number;
  /** Filter by frontmatter type. */
  types?: string[];
  /** Filter by domain. */
  domains?: string[];
  /** Boost entries that link to or are linked from this file path. */
  contextFile?: string;
}

/**
 * KnowledgeIndexService — lightweight in-memory index built from metadataCache.
 *
 * Design:
 *  - No embedding, no external dependency.
 *  - Built once on load, updated incrementally via metadataCache events.
 *  - Three-layer scoring: exact match → structural (links/backlinks/domain) → keyword.
 *
 * Usage:
 *  ```
 *  const idx = new KnowledgeIndexService(app);
 *  idx.rebuild();
 *  const results = idx.search("并发控制");
 *  ```
 */
export class KnowledgeIndexService {
  private entries: Map<string, IndexEntry> = new Map();

  constructor(private app: App) {}

  // ── Build / Rebuild ────────────────────────────────────────

  /** Full rebuild. Call once on plugin load. */
  rebuild(): void {
    this.entries.clear();
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      this.indexFile(file);
    }
    this.computeBacklinks();
  }

  /** Incremental update for a single file. */
  updateFile(file: TFile): void {
    this.indexFile(file);
    // Recompute backlinks (cheap for incremental — just re-scan outgoing of this file)
    this.computeBacklinks();
  }

  /** Remove a file from the index. */
  removeFile(path: string): void {
    this.entries.delete(path);
    // Clean backlinks pointing to this file
    for (const entry of this.entries.values()) {
      entry.backlinks = entry.backlinks.filter((b) => b !== path);
    }
  }

  // ── Search ─────────────────────────────────────────────────

  /**
   * Search the index for entries relevant to the given query.
   *
   * Scoring layers:
   *  1. Exact title/basename match (score += 10)
   *  2. Tag match (score += 5)
   *  3. Heading match (score += 3)
   *  4. Link/backlink match (score += 4)
   *  5. Domain match (score += 3)
   *  6. Concept list match (score += 4)
   *  7. Keyword substring in title/headings (score += 2)
   *
   * If `contextFile` is provided, entries linked from/to it get +3 boost.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const { limit = 10, types, domains, contextFile } = options;
    const terms = this.tokenize(query);
    if (terms.length === 0) return [];

    const contextLinks = contextFile ? this.getLinksOf(contextFile) : new Set<string>();

    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      // Filters
      if (types && types.length > 0 && (!entry.type || !types.includes(entry.type))) continue;
      if (domains && domains.length > 0 && (!entry.domain || !domains.includes(entry.domain))) continue;

      let score = 0;
      const matchedOn: SearchResult["matchedOn"] = [];

      for (const term of terms) {
        const lower = term.toLowerCase();

        // 1. Title / basename
        if (entry.title.toLowerCase().includes(lower) || entry.basename.toLowerCase().includes(lower)) {
          score += entry.title.toLowerCase() === lower ? 10 : 5;
          if (!matchedOn.includes("title")) matchedOn.push("title");
        }

        // 2. Tags
        if (entry.tags.some((t) => t.toLowerCase().includes(lower))) {
          score += 5;
          if (!matchedOn.includes("tag")) matchedOn.push("tag");
        }

        // 3. Headings
        if (entry.headings.some((h) => h.toLowerCase().includes(lower))) {
          score += 3;
          if (!matchedOn.includes("heading")) matchedOn.push("heading");
        }

        // 4. Outgoing links
        if (entry.links.some((l) => l.toLowerCase().includes(lower))) {
          score += 4;
          if (!matchedOn.includes("link")) matchedOn.push("link");
        }

        // 5. Concepts
        if (entry.concepts.some((c) => c.toLowerCase().includes(lower))) {
          score += 4;
          if (!matchedOn.includes("concept")) matchedOn.push("concept");
        }

        // 6. Domain
        if (entry.domain && entry.domain.toLowerCase().includes(lower)) {
          score += 3;
          if (!matchedOn.includes("domain")) matchedOn.push("domain");
        }
      }

      // Context boost
      if (contextFile && (contextLinks.has(entry.path) || entry.links.includes(contextFile))) {
        score += 3;
      }

      if (score > 0) {
        results.push({ entry, score, matchedOn });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /** Get all entries of a given type. */
  getByType(type: string): IndexEntry[] {
    return [...this.entries.values()].filter((e) => e.type === type);
  }

  /** Get all entries in a given domain. */
  getByDomain(domain: string): IndexEntry[] {
    return [...this.entries.values()].filter((e) => e.domain === domain);
  }

  /** Get known domains. */
  getDomains(): string[] {
    const set = new Set<string>();
    for (const e of this.entries.values()) {
      if (e.domain) set.add(e.domain);
    }
    return [...set].sort();
  }

  /** Get all concept names (type=concept entries). */
  getConceptNames(): string[] {
    return [...this.entries.values()]
      .filter((e) => e.type === "concept")
      .map((e) => e.basename);
  }

  /** Get entry by path. */
  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  /** Total entries in the index. */
  get size(): number {
    return this.entries.size;
  }

  /** Get all entries as an array. */
  getAll(): IndexEntry[] {
    return [...this.entries.values()];
  }

  // ── Internals ──────────────────────────────────────────────

  private indexFile(file: TFile): void {
    const meta: CachedMetadata | null = this.app.metadataCache.getFileCache(file);
    const fm = meta?.frontmatter;

    const title = meta?.headings?.find((h) => h.level === 1)?.heading ?? file.basename;
    const headings = (meta?.headings ?? [])
      .filter((h) => h.level === 2)
      .map((h) => h.heading);
    const tags = [
      ...(meta?.tags ?? []).map((t) => t.tag.replace(/^#/, "")),
      ...((fm?.tags as string[] | undefined) ?? []),
    ];
    const links = (meta?.links ?? []).map((l) => l.link);
    const concepts: string[] = Array.isArray(fm?.concepts) ? (fm!.concepts as string[]) : [];

    const entry: IndexEntry = {
      path: file.path,
      basename: file.basename,
      title,
      type: fm?.type as string | undefined,
      domain: fm?.domain as string | undefined,
      status: fm?.status as string | undefined,
      tags,
      headings,
      links,
      backlinks: this.entries.get(file.path)?.backlinks ?? [],
      concepts,
      mtime: file.stat.mtime,
    };

    this.entries.set(file.path, entry);
  }

  private computeBacklinks(): void {
    // Reset all backlinks
    for (const entry of this.entries.values()) {
      entry.backlinks = [];
    }
    // Build
    for (const entry of this.entries.values()) {
      for (const link of entry.links) {
        // Resolve link to a path
        const resolved = this.resolveLink(link, entry.path);
        if (resolved) {
          const target = this.entries.get(resolved);
          if (target && !target.backlinks.includes(entry.path)) {
            target.backlinks.push(entry.path);
          }
        }
      }
    }
  }

  private resolveLink(link: string, fromPath: string): string | null {
    // Use Obsidian's resolve to handle relative paths, aliases, etc.
    const file = this.app.metadataCache.getFirstLinkpathDest(link, fromPath);
    return file?.path ?? null;
  }

  private getLinksOf(path: string): Set<string> {
    const entry = this.entries.get(path);
    if (!entry) return new Set();
    const set = new Set<string>();
    for (const link of entry.links) {
      const resolved = this.resolveLink(link, path);
      if (resolved) set.add(resolved);
    }
    for (const bl of entry.backlinks) {
      set.add(bl);
    }
    return set;
  }

  private tokenize(query: string): string[] {
    // Split on whitespace, punctuation, and common separators
    return query
      .split(/[\s,;、，；]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 1);
  }
}
