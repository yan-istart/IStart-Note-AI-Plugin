import type { DeepSeekSettings } from "../../types";
import type { AgentTask, NoteReference } from "./types";

export interface TaskField {
  key: string;
  label: string;
  type?: "number" | "boolean" | "multiline";
  required?: boolean;
  min?: number;
  max?: number;
  choices?: Record<string, string>;
}
export interface TaskDefinition {
  label: string;
  tool: string;
  mode?: "ask";
  context: "none" | "note" | "selection" | "cursor";
  configure?: boolean;
  args?: AgentTask["args"];
  fields: TaskField[];
}
const instruction: TaskField = { key: "instruction", label: "附加要求", type: "multiline" };
const words: TaskField = { key: "targetWords", label: "目标字数", type: "number", required: true, min: 1, max: 10000 };
const scope: TaskField = { key: "contextScope", label: "上下文范围", choices: { full: "完整文档与作品资料", nearby: "光标附近" } };
const continuation: TaskDefinition = {
  label: "续写", tool: "writing.generate", context: "cursor", args: { task: "continue" },
  fields: [words, { key: "mode", label: "写入位置", choices: { cursor: "光标处", chapter: "文末" } }, scope, instruction],
};
const insertion: TaskDefinition = { label: "插写", tool: "writing.generate", context: "cursor", args: { task: "insert" }, fields: [words, scope, instruction] };

export const AGENT_TASKS: Record<string, TaskDefinition> = {
  "beautify-note": { label: "美化当前文档", tool: "document.beautify", context: "note", fields: [instruction] },
  "check-typos": { label: "错别字甄别", tool: "document.proofread", mode: "ask", context: "note", fields: [] },
  "knowledge-debt": { label: "检查知识债务", tool: "knowledge.debt", mode: "ask", context: "none", fields: [] },
  "annotation-suggest": { label: "批注 AI 建议", tool: "annotation.assist", context: "selection", args: { task: "suggest" }, fields: [] },
  "annotation-rewrite": { label: "AI 重写批注", tool: "annotation.assist", context: "selection", args: { task: "rewrite" }, fields: [] },
  "import-classify": { label: "原稿智能分类", tool: "import.classify", mode: "ask", context: "none", fields: [] },
  "import-analyze": { label: "原稿元数据分析", tool: "import.analyze", mode: "ask", context: "none", fields: [] },
  "continue-writing": continuation,
  "continue-writing-settings": { ...continuation, configure: true },
  "insert-writing": insertion,
  "insert-writing-settings": { ...insertion, configure: true },
  "polish-writing": { label: "润色选中文字", tool: "writing.generate", context: "selection", args: { task: "polish" }, fields: [instruction] },
  "expand-selection": { label: "扩写选中文字", tool: "document.generate", context: "selection", args: { task: "expand" }, fields: [instruction] },
  "explain-selection": { label: "解释选中文字", tool: "document.generate", mode: "ask", context: "selection", args: { task: "explain" }, fields: [instruction] },
  "summarize-note": { label: "总结当前笔记", tool: "document.generate", mode: "ask", context: "note", args: { task: "summarize" }, fields: [instruction] },
  "generate-next-chapter": { label: "生成下一章", tool: "writing.generate", context: "note", args: { task: "next-chapter" }, fields: [{ ...words, max: 30000 }, instruction] },
  "extract-characters": { label: "提取角色卡", tool: "writing.generate", context: "note", args: { task: "characters" }, fields: [] },
  "ai-annotation": { label: "AI 批注", tool: "annotation.assist", context: "selection", args: { task: "draft" }, fields: [] },
  "complete-current-concept": { label: "补全当前概念页", tool: "concept.complete", context: "note", fields: [{ key: "depth", label: "补全深度", choices: { light: "精简", standard: "标准" } }] },
  "scan-empty-concepts": { label: "扫描空概念页", tool: "concept.scan", context: "none", fields: [] },
  "question-with-graph": { label: "知识提问", tool: "question.generate", context: "none", configure: true, fields: [{ key: "question", label: "问题", required: true, type: "multiline" }] },
  "new-reading-project": { label: "新建阅读项目", tool: "reading.plan", context: "none", configure: true, fields: [{ key: "book", label: "书名", required: true }, { key: "contents", label: "目录（可选）", type: "multiline" }, { key: "projectName", label: "项目目录名（可选）" }] },
  "new-writing-project": { label: "新建作品", tool: "writing.plan", context: "none", configure: true, fields: [{ key: "title", label: "作品名", required: true }, { key: "genre", label: "体裁", required: true, choices: { novel: "小说", paper: "论文", article: "长文" } }, { key: "premise", label: "作品简介与要求", required: true, type: "multiline" }] },
  "create-artifact": { label: "生成实用模板", tool: "artifact.generate", context: "note", configure: true, fields: [
    { key: "target", label: "用途与目标", required: true, type: "multiline" },
    { key: "type", label: "模板类型", choices: { checklist: "检查表", routine: "例行流程", sop: "SOP", plan: "行动计划", review: "复盘表", "question-list": "问题清单", decision: "决策表", custom: "自定义" } },
    { key: "usageMode", label: "使用方式", choices: { template: "模板", "one-off": "一次性使用", recurring: "例行使用" } },
    { key: "evidencePolicy", label: "来源策略", choices: { strict: "严格来源", balanced: "平衡", freeform: "自由生成" } },
    { key: "createRun", label: "同时生成今日记录", type: "boolean" }, instruction,
  ] },
};

export function createAgentTask(actionId: string, settings: DeepSeekSettings, reference?: NoteReference): AgentTask {
  const def = AGENT_TASKS[actionId];
  if (!def) throw new Error("不支持的助手任务");
  if (def.context !== "none" && !reference) throw new Error("请先打开需要处理的笔记");
  if (def.context === "selection" && !reference?.selection?.text.trim()) throw new Error("请先选中需要处理的文字");
  if (def.context === "cursor" && (!reference?.cursor || reference.selection)) throw new Error("请取消选区并将光标放在正文中");
  const args = { ...def.args };
  if (def.tool === "writing.generate" && ["continue", "insert", "next-chapter"].includes(String(args.task))) {
    args.targetWords = args.task === "insert" ? settings.insertTargetWords : args.task === "next-chapter" ? settings.continueTargetWords * 3 : settings.continueTargetWords;
    args.contextScope = settings.writingContextScope;
    if (args.task === "continue") args.mode = settings.continueMode;
  }
  if (def.tool === "concept.complete") { args.path = reference!.path; args.depth = "standard"; }
  if (def.tool === "writing.plan") args.genre = "novel";
  if (def.tool === "artifact.generate") Object.assign(args, { type: "checklist", usageMode: "template", evidencePolicy: "balanced", createRun: false });
  return { actionId, tool: def.tool, mode: def.mode ?? "agent", args };
}

export function validAgentTask(value: unknown): value is AgentTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as AgentTask;
  if (typeof task.actionId !== "string" || !Object.prototype.hasOwnProperty.call(AGENT_TASKS, task.actionId)) return false;
  const def = AGENT_TASKS[task.actionId];
  return !!def && task.tool === def.tool && task.mode === (def.mode ?? "agent") && !!task.args && typeof task.args === "object" && !Array.isArray(task.args)
    && Object.values(task.args).every(v => typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 50000))
    && Object.entries(def.args ?? {}).every(([key, v]) => task.args[key] === v);
}

export function validateTaskFields(task: AgentTask): void {
  if (!validAgentTask(task)) throw new Error("助手任务参数无效");
  for (const field of AGENT_TASKS[task.actionId].fields) {
    const value = task.args[field.key];
    if (value === undefined || value === "") { if (field.required) throw new Error(`请填写${field.label}`); else continue; }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < (field.min ?? 1) || value > (field.max ?? 10000)) throw new Error(`${field.label}超出范围`);
    } else if (field.type === "boolean") { if (typeof value !== "boolean") throw new Error(`${field.label}无效`); }
    else if (typeof value !== "string" || (field.required && !value.trim()) || (field.choices && !(value in field.choices))) throw new Error(`请填写有效的${field.label}`);
  }
}

export function taskDescription(task: AgentTask): string {
  const def = AGENT_TASKS[task.actionId];
  return [def.label, ...def.fields.filter(f => task.args[f.key] !== undefined && task.args[f.key] !== "").map(f => {
    const value = task.args[f.key];
    return `${f.label}：${f.choices?.[String(value)] ?? (typeof value === "boolean" ? value ? "是" : "否" : value)}`;
  })].join("\n");
}
