import { describe, expect, it } from "vitest";
import { completeReadingQuestions, questionEvolution, readingProgress, yamlScalar } from "./WorkflowDrafts";

describe("complete reading and question workflows", () => {
  it("preserves handwritten questions and notes while adding deduplicated AI questions", () => {
    const note = '---\ntype: reading-note\nquestions_generated: false\n---\n\n# Chapter\n\n## 读前问题\n\n- [ ] My question?\n\n## 我的理解\n\nKeep $& and my notes.\n';
    const result = completeReadingQuestions(note, ["My question?", "New question?", "New question?", "What is $&?"]);
    expect(result).toContain("Keep $& and my notes."); expect(result.match(/My question\?/g)).toHaveLength(1); expect(result.match(/New question\?/g)).toHaveLength(1);
    expect(result).toContain("What is $&?"); expect(yamlScalar(result, "questions_generated")).toBe("true");
    expect(readingProgress('---\ntype: reading-project\n---\n# Map', [result])).toContain("generation_status: complete");
  });
  it("removes placeholders, keeps later sections, and reports partial progress accurately", () => {
    const before = '---\ntype: reading-note\nquestions_generated: false\n---\n\n## 读前问题\n\n（待生成）\n\n## 要点\n\nRemember this\n';
    const done = completeReadingQuestions(before, ["Why?"]);
    expect(done).not.toContain("待生成"); expect(done).toContain("## 要点\n\nRemember this");
    const map = readingProgress('---\nbook: "Book #1"\n---\n\n# Map', [done, before]);
    expect(yamlScalar(map, "book")).toBe("Book #1"); expect(map).toContain("chapters_generated: 1"); expect(map).toContain("chapters_total: 2"); expect(map).toContain("generation_status: partial");
  });
  it("includes missing parent nodes and replaces only the generated question graph", () => {
    const original = '# Index\n\n## 问题演化\n\n```mermaid\ngraph TD\nold\n```\n\n## My notes\nPreserve this';
    const result = questionEvolution(original, [{ title: 'Child "quoted"', category: "refinement", parent: "Parent" }]);
    expect(result).toContain('["Parent"]'); expect(result).toContain("-->|深化|"); expect(result).not.toContain("\nold\n"); expect(result).toContain("## My notes\nPreserve this"); expect(result.match(/```mermaid/g)).toHaveLength(1);
  });
});
