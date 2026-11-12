import type { DeepSeekSettings } from "../../../types";
import type { AgentController } from "../../agent/AgentController";
import { createAgentTask } from "../../../core/agent/AgentTasks";
import { ClassifyUnit, ImportAnalysis, sampleChapters } from "./ImportAnalyzer";
import type { RawChapter, MaterialKind } from "./ChapterSplitter";
import type { WritingGenre } from "../types";

/** File selection, splitting and import stay native; AI calls are visible, retryable Agent tasks. */
export class ImportAgentBridge {
  private sessionId?: string;
  constructor(private agent: AgentController, private settings: DeepSeekSettings) {}
  private async run(actionId: string, args: Record<string, string>, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error("任务已停止");
    const task = createAgentTask(actionId, this.settings);
    Object.assign(task.args, args);
    const result = await this.agent.executeTask(task, this.sessionId, signal);
    this.sessionId = result.sessionId;
    return result.message.content;
  }
  async classify(units: ClassifyUnit[], signal: AbortSignal): Promise<Map<number, MaterialKind>> {
    const result = new Map<number, MaterialKind>();
    for (let offset = 0; offset < units.length; offset += 50) {
      const chunk = units.slice(offset, offset + 50).map(u => ({ index: u.index, title: u.title.slice(0, 200), head: u.head.slice(0, 200) }));
      while (JSON.stringify(chunk).length > 49000) chunk.forEach(u => { u.head = u.head.slice(0, Math.floor(u.head.length * .8)); u.title = u.title.slice(0, Math.floor(u.title.length * .8)); });
      const parsed: { classifications: { index: number; kind: MaterialKind }[] } = JSON.parse(await this.run("import-classify", { units: JSON.stringify(chunk) }, signal));
      for (const item of parsed.classifications) result.set(item.index, item.kind);
    }
    return result;
  }
  async analyze(title: string, genre: WritingGenre, chapters: RawChapter[], signal: AbortSignal): Promise<ImportAnalysis> {
    // Include only chapter samples, never the external source path or the full manuscript.
    const samples = sampleChapters(chapters.filter(ch => !ch.kind || ch.kind === "chapter"), 8).map(ch => ({ number: ch.number, title: ch.title.slice(0, 200), content: ch.content.slice(0, 2000) }));
    // JSON escaping can grow control-heavy text beyond the tool's argument limit.
    while (JSON.stringify(samples).length > 49000) samples.forEach(ch => { ch.content = ch.content.slice(0, Math.floor(ch.content.length * .8)); });
    return JSON.parse(await this.run("import-analyze", { title: title || "未命名", genre, chapters: JSON.stringify(samples) }, signal)) as ImportAnalysis;
  }
}
