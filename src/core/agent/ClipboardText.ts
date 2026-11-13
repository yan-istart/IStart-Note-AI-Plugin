import type { AgentMessage, AgentSession } from "./types";
import { isLiveStory } from "./types";
import { serializeStory } from "./StoryContent";

export function messageText(message: AgentMessage): string {
  const parts = [isLiveStory(message.story) ? serializeStory(message.story.confirmedAt !== undefined ? message.story.confirmedBlocks ?? [] : message.story.blocks) : message.content];
  if (message.error) parts.push(`错误：${message.error}`);
  if (message.skills?.length) parts.push(`技能：${message.skills.join("、")}`);
  if (message.references?.length) parts.push(message.references.map(r => `引用：${r.path}${r.selection ? `\n选区：\n${r.selection.text}` : ""}${r.annotation ? `\n批注：\n${r.annotation}` : ""}`).join("\n\n"));
  if (message.sources?.length) parts.push(`来源：\n${message.sources.join("\n")}`);
  if (message.steps?.length) parts.push(`执行记录：\n${message.steps.map(s => `${s.label} · ${s.status}\n${s.detail ?? ""}`).join("\n\n")}`);
  if (message.story) {
    parts.push(...message.story.turns.map(t => `第${t.round}轮 · ${t.name}\n\n${t.content}`));
    if (message.story.evolution) parts.push(`角色推演 · ${message.story.evolution.status}\n\n${message.story.evolution.content}${message.story.evolution.error ? `\n${message.story.evolution.error}` : ""}`);
  }
  for (const p of message.proposals ?? []) parts.push(`修改：${p.title} · ${p.status}\n\n${p.changes.map(c => `文件：${c.path}\n\n修改前：\n${c.before ?? "（新文件）"}\n\n修改后：\n${c.after}`).join("\n\n")}`);
  if (message.proofreading) parts.push(`校对：${message.proofreading.path}\n${message.proofreading.result.issues.map(i => `${i.original} → ${i.correction}：${i.reason}`).join("\n")}`);
  return parts.filter(Boolean).join("\n\n");
}
export function conversationText(session: AgentSession): string {
  return [`# ${session.title}`, session.summary ? `较早对话摘要\n\n${session.summary.content}` : "", ...session.messages.map(m => `## ${m.role === "user" ? "我" : "IStart"}\n\n${messageText(m)}`)].filter(Boolean).join("\n\n");
}
