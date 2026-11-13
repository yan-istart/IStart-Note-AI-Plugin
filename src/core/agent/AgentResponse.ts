export type AgentDecision = { type: "answer"; content: string } | { type: "tool"; name: string; args: unknown };

/** Escape literal control characters without guessing missing quotes, values or tool arguments. */
function escapeStringControls(raw: string): string {
  let quoted = false, escaped = false, result = "";
  for (const char of raw) {
    if (quoted && !escaped && char.charCodeAt(0) < 32) {
      result += JSON.stringify(char).slice(1, -1);
      continue;
    }
    result += char;
    if (escaped) escaped = false;
    else if (quoted && char === "\\") escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  return result;
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return JSON.parse(escapeStringControls(raw)); }
}

/** Locate the complete root object, ignoring braces in strings and nested objects. */
function objectEnd(raw: string): number {
  let depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return index + 1;
  }
  return -1;
}

function decision(value: unknown): AgentDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.type === "answer" && typeof data.content === "string" && data.content.trim()) return { type: "answer", content: data.content };
  if (data.type === "tool" && typeof data.name === "string" && data.name.trim() && data.args && typeof data.args === "object" && !Array.isArray(data.args)) {
    return { type: "tool", name: data.name, args: data.args };
  }
  return null;
}

export function parseDecision(raw: string): AgentDecision {
  const text = raw.trim();
  if (!text) throw new Error("模型返回了空回答");
  // Parse the envelope before looking for fences: its Markdown content can itself contain code.
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*)\r?\n```[ \t]*$/i.exec(text);
  const payload = (fence?.[1] ?? text).trim();
  let value: unknown;
  try { value = parseJson(payload); }
  catch {
    if (payload.startsWith("{")) {
      const end = objectEnd(payload);
      // Some responses add closing braces after an otherwise complete request.
      // Never accept a second object, trailing instructions or a truncated request.
      if (end > 0 && /^[}\s]*$/.test(payload.slice(end))) {
        try { value = parseJson(payload.slice(0, end)); } catch { /* Request a corrected envelope below. */ }
      }
    }
  }
  const parsed = decision(value);
  if (parsed) return parsed;
  // Standalone Markdown/code is a normal answer; malformed protocol stays an error.
  if (!/^[{[]/.test(payload) && !/^```json[ \t]*(?:\r?\n|$)/i.test(text)) return { type: "answer", content: raw };
  throw new Error("模型没有返回有效的回答或工具请求");
}

export function partialAnswer(raw: string): string | null {
  const text = raw.trimStart().replace(/^```(?:json)?[ \t]*\r?\n/i, "");
  // Only stream the answer envelope, never a nested answer example inside tool arguments.
  const match = /^\{\s*"type"\s*:\s*"answer"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
  if (!match) return null;
  let encoded = match[1];
  if (/\\$/.test(encoded)) encoded = encoded.slice(0, -1);
  encoded = encoded.replace(/\\u[0-9a-f]{0,3}$/i, "");
  try { return parseJson(`"${encoded}"`) as string; } catch { return null; }
}
