import { describe, expect, it } from "vitest";
import { cleanAnnotationDraft, cleanAnnotationSuggestion } from "./AnnotationAssistant";

describe("annotation AI output cleanup", () => {
  it("removes wrappers from annotation drafts", () => {
    expect(cleanAnnotationDraft("```markdown\n批注：这是一条批注。\n```")).toBe("这是一条批注。");
    expect(cleanAnnotationDraft("“带引号的批注”")).toBe("带引号的批注");
  });

  it("keeps suggestion Markdown while removing code fences and labels", () => {
    const raw = "```md\n建议：\n- 补充一个反例\n- 关联到另一篇笔记\n```";
    expect(cleanAnnotationSuggestion(raw)).toBe("- 补充一个反例\n- 关联到另一篇笔记");
  });
});
