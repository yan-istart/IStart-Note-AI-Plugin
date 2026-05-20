/**
 * Frontmatter schema version for plugin-managed notes.
 *
 * Bump when:
 *  - The shape of frontmatter fields changes (rename/remove/retype).
 *  - The semantics of an existing field change.
 *
 * Migration code lives in `src/core/schema/migrations/` (added on first bump).
 *
 * Currently affects:
 *  - Concept pages (`type: concept`)
 *  - Question Q&A notes (`type: question`)
 *  - Domain index pages (`type: domain-index`)
 */
export const SCHEMA_VERSION = 1;

/** Today's date in ISO `YYYY-MM-DD` form, in the local timezone. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
