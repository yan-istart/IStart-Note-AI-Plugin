import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { DEFAULT_SKILL_SETTINGS } from "../../types";
import { SkillRegistry } from "./SkillRegistry";

const files: Record<string, string> = {
  "Skills/writing-craft/SKILL.md": `---
name: Craft
description: Shared craft
metadata:
  istart/scope: global
---
# Craft`,
  "Skills/work-example/SKILL.md": `---
name: Example
description: Work rules
metadata:
  istart/scope: project
  istart/project: Example
---
# Work`,
};

function app(): App {
  return {
    vault: {
      adapter: {
        list: async (path: string) => {
          if (path === "Skills") return { files: [], folders: ["Skills/writing-craft", "Skills/work-example"] };
          if (path === "Skills/writing-craft") return { files: ["Skills/writing-craft/SKILL.md"], folders: [] };
          if (path === "Skills/work-example") return { files: ["Skills/work-example/SKILL.md"], folders: [] };
          return { files: [], folders: [] };
        },
        read: async (path: string) => files[path] ?? "",
      },
    },
  } as unknown as App;
}

describe("writing skill registry", () => {
  it("discovers folder skills and keeps the visible root first", async () => {
    const registry = new SkillRegistry(app(), () => ({ ...DEFAULT_SKILL_SETTINGS, roots: ["Skills", ".agents/skills"] }));
    const skills = await registry.refresh();
    expect(skills.map((skill) => skill.id).sort()).toEqual(["work-example", "writing-craft"]);
    expect(registry.isSkillPath("Skills/writing-craft/SKILL.md")).toBe(true);
    expect(registry.isSkillPath(".agents/skills/writing-craft/SKILL.md")).toBe(true);
    expect(registry.isSkillPath("Writing/Novels/Other.md")).toBe(false);
  });
});
