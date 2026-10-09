/**
 * Frontmatter schema version for plugin-managed notes.
 *
 * v2 (2026-09-30):
 *  - 新增写作域类型:writing-project / chapter / outline / character / setting。
 *  - 移除执行域类型(execution-plan / execution / plan)。
 *
 * Currently affects:
 *  - Concept pages (`type: concept`)
 *  - Question Q&A notes (`type: question`)
 *  - Domain index pages (`type: domain-index`)
 *  - Writing notes (`type: writing-project` / `chapter` / `outline` / `character` / `setting`)
 */
export const SCHEMA_VERSION = 2;

/** Today's date in ISO `YYYY-MM-DD` form, in the local timezone. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
