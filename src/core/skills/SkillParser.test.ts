import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "./SkillParser";

const base = (frontmatter: string, body = "# Skill\n\nRules.") => `---\n${frontmatter}\n---\n\n${body}`;

describe("writing skill parser", () => {
  it("parses a public writing skill", () => {
    const skill = parseSkillMarkdown(base([
      "name: writing-craft",
      "description: Shared writing craft rules",
      "metadata:",
      "  istart/scope: global",
      "  istart/genre: any",
      "  istart/priority: 12",
    ].join("\n")), "writing-craft", "Skills/writing-craft/SKILL.md", "Skills");

    expect(skill).toMatchObject({
      id: "writing-craft",
      name: "writing-craft",
      description: "Shared writing craft rules",
      scope: "global",
      apply: "writing",
      priority: 12,
      path: "Skills/writing-craft/SKILL.md",
      root: "Skills",
    });
    expect(skill?.genre).toBeUndefined();
    expect(skill?.body).toBe("# Skill\n\nRules.");
  });

  it("parses a work-scoped skill with quoted Chinese metadata", () => {
    const skill = parseSkillMarkdown(base([
      'name: "内窥 · 写作规范"',
      'description: "Use only for the work 内窥"',
      "metadata:",
      "  istart/scope: project",
      '  istart/project: "内窥"',
      '  istart/project-path: "Writing/Novels/内窥"',
      "  istart/genre: novel",
      "  istart/apply: all",
    ].join("\n")), "work-neikui", "Skills/work-neikui/SKILL.md", "Skills");

    expect(skill).toMatchObject({
      name: "内窥 · 写作规范",
      scope: "project",
      project: "内窥",
      projectPath: "Writing/Novels/内窥",
      genre: "novel",
      apply: "all",
      priority: 30,
    });
  });

  it("accepts dotted aliases and defaults unknown metadata to a global writing skill", () => {
    const skill = parseSkillMarkdown(base([
      "name: Notes style",
      "description: Use for notes",
      "metadata:",
      "  istart.scope: genre",
      "  istart.genre: article",
    ].join("\n")), "notes-style", "Skills/notes-style/SKILL.md", "Skills");

    expect(skill).toMatchObject({ scope: "genre", genre: "article", apply: "writing", priority: 20 });
  });

  it("requires frontmatter, a description, and a non-empty body", () => {
    expect(parseSkillMarkdown("# No frontmatter", "x", "Skills/x/SKILL.md", "Skills")).toBeNull();
    expect(parseSkillMarkdown(base("name: x"), "x", "Skills/x/SKILL.md", "Skills")).toBeNull();
    expect(parseSkillMarkdown(base("name: x\ndescription: y", "   "), "x", "Skills/x/SKILL.md", "Skills")).toBeNull();
  });

  it("keeps colons in descriptions", () => {
    const skill = parseSkillMarkdown(base([
      "name: x",
      "description: Use when writing: novels and essays",
    ].join("\n")), "x", "Skills/x/SKILL.md", "Skills");
    expect(skill?.description).toBe("Use when writing: novels and essays");
  });
});
