/**
 * Tolerant JSON extractor for LLM outputs.
 *
 * LLMs frequently wrap JSON in ```json ... ``` fences or surround it with
 * explanatory prose. These helpers locate and parse the JSON payload safely.
 */

/** Locate the JSON-looking substring inside an LLM response. */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];

  const braced = raw.match(/(\{[\s\S]*\})/);
  if (braced) return braced[1];

  return raw;
}

/**
 * Parse JSON from an LLM response, returning `fallback` on any failure.
 * Never throws.
 */
export function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(extractJson(raw).trim()) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parse JSON from an LLM response. Throws if the payload is not valid JSON.
 * Use when an empty/default value is not acceptable upstream.
 */
export function parseJsonStrict<T>(raw: string): T {
  return JSON.parse(extractJson(raw).trim()) as T;
}
