import type { AgentRunContext, ChangeProposal, ProofreadingReport } from "./types";
export type ToolArguments = Record<string, string | number | boolean>;
export interface ToolField { type: "string" | "number" | "boolean"; required?: boolean; choices?: string[] }
export interface ToolResult { content: string; proposals?: ChangeProposal[]; proofreading?: ProofreadingReport }
export interface AgentTool {
  name: string;
  description: string;
  label: string;
  draft?: boolean;
  fields: Record<string, ToolField>;
  execute(args: ToolArguments, context: AgentRunContext): Promise<ToolResult>;
}
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();
  add(tool: AgentTool): void {
    if (this.tools.has(tool.name)) throw new Error(`重复工具：${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  describe(mode: AgentRunContext["mode"]): string {
    return JSON.stringify([...this.tools.values()].filter(t => mode === "agent" || !t.draft).map(t => ({ name: t.name, description: t.description, parameters: t.fields })));
  }
  get(name: string, input: unknown, mode: AgentRunContext["mode"]): { tool: AgentTool; args: ToolArguments } {
    const tool = this.tools.get(name);
    if (!tool || (tool.draft && mode !== "agent")) throw new Error(`此模式下不可用的工具：${name}`);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("工具参数必须是对象");
    const args: ToolArguments = {};
    for (const [key, value] of Object.entries(input)) {
      const field = tool.fields[key];
      if (!field || typeof value !== field.type || (typeof value === "string" && (value.length > 50000 || (field.choices && !field.choices.includes(value)))) || (typeof value === "number" && !Number.isFinite(value))) throw new Error(`工具参数无效：${key}`);
      args[key] = value;
    }
    for (const [key, field] of Object.entries(tool.fields)) if (field.required && (args[key] === undefined || args[key] === "")) throw new Error(`缺少工具参数：${key}`);
    return { tool, args };
  }
}
