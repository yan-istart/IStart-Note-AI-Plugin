/**
 * 安全的 frontmatter 读取工具。
 *
 * Obsidian 的 FrontMatterCache 类型是 Record<string, any>,
 * 直接把 any 泄漏到业务代码会触发 no-unsafe-member-access 等 lint 规则。
 * 这里统一收窄为 Record<string, unknown>,取值处再做显式收窄。
 */

export type SafeFrontmatter = Record<string, unknown>;

export function frontmatterOf(
  meta: { frontmatter?: SafeFrontmatter } | null | undefined
): SafeFrontmatter | undefined {
  return meta?.frontmatter;
}

/** 读取 frontmatter 中的字符串字段 */
export function fmString(fm: SafeFrontmatter | undefined, key: string): string | undefined {
  const value = fm?.[key];
  return typeof value === "string" ? value : undefined;
}

/** 读取 frontmatter 中的数字字段 */
export function fmNumber(fm: SafeFrontmatter | undefined, key: string): number | undefined {
  const value = fm?.[key];
  return typeof value === "number" ? value : undefined;
}
