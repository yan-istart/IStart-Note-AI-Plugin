import type { AgentSession, StoryBlock, StoryScene, StoryTarget } from "./types";
import { isLiveStory } from "./types";
import { yamlScalar } from "./WorkflowDrafts";

export function storyName(scene: StoryScene, path: string): string {
  const card = scene.cast.find(c => c.path === path);
  return card && yamlScalar(card.content, "name") || path.split("/").pop()?.replace(/\.md$/, "") || "角色";
}
export function serializeStory(blocks: StoryBlock[], includeIncomplete = true): string {
  return blocks.filter(b => !b.omitted && (includeIncomplete || b.status === "completed")).map(b => b.text).join("\n\n");
}
export function visibleStory(blocks: StoryBlock[], path?: string): StoryBlock[] {
  return blocks.filter(b => !b.omitted && b.status === "completed" && (b.visibility === "public" || (path !== undefined && b.ownerPath === path)));
}
export function storyContext(session: AgentSession, scene: StoryScene, path?: string): string {
  const current = isLiveStory(scene) ? scene : undefined;
  if (!current) throw new Error("旧版场景请从新场景继续演绎");
  // Never infer public knowledge by parsing legacy prose, or use the reader's full manuscript as actor memory.
  const history = session.messages.flatMap(m => m.story !== scene && m.story?.confirmedAt !== undefined && m.story.projectPath === scene.projectPath && isLiveStory(m.story) ? m.story.confirmedBlocks ?? [] : []);
  const published = [...visibleStory(history, path), ...visibleStory(current.blocks, path)].map(b => `${b.kind === "dialogue" ? `${storyName(scene, b.characterPath!)}：` : ""}${b.text}`).join("\n\n");
  const references = current.runtime.notes.filter(n => !n.path.includes("/_角色/") && !n.path.includes("/_设定/"));
  const material = references.map(n => `[[${n.path}]]\n${n.selection?.text ?? n.content}`).join("\n\n");
  const world = current.runtime.writing?.worldSettings.map(w => `${w.name}：${w.content}`).join("\n") ?? "";
  return `作品：${current.runtime.scope.projectTitle}\n场景要求（作者指令，不属于角色已听见的台词）：\n${current.runtime.task}\n待执行作者调度（只对下次回应生效，不自动成为角色已知事实）：\n${current.runtime.directives.filter(d => !d.applied).map(d => d.text).join("\n")}\n世界规则（背景资料）：\n${world}\n引用材料（作者参考，不等同于角色亲历的信息）：\n${material}\n本角色可感知的演绎与已确认经历：\n${published || "尚无"}`;
}
export function validStoryTarget(scene: StoryScene, target: StoryTarget): boolean {
  return target === "scene" || target === "end" || scene.cast.some(c => c.path === target);
}
