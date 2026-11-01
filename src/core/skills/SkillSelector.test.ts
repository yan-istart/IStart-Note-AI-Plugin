import { describe, expect, it } from "vitest";
import { DEFAULT_SKILL_SETTINGS } from "../../types";
import type { SkillDefinition } from "./types";
import { selectSkills } from "./SkillSelector";

function skill(partial: Partial<SkillDefinition> & Pick<SkillDefinition, "id" | "name" | "scope">): SkillDefinition {
  return {
    description: "",
    body: `${partial.id} body`,
    apply: "writing",
    priority: partial.scope === "project" ? 30 : partial.scope === "genre" ? 20 : 10,
    path: `Skills/${partial.id}/SKILL.md`,
    root: "Skills",
    ...partial,
  };
}

const settings = { ...DEFAULT_SKILL_SETTINGS };
const writingScope = {
  projectTitle: "内窥",
  projectPath: "Writing/Novels/内窥",
  genre: "novel",
};

const globalSkill = skill({ id: "writing-craft", name: "Craft", scope: "global" });
const genreSkill = skill({ id: "writing-webnovel", name: "Webnovel", scope: "genre", genre: "novel" });
const otherGenreSkill = skill({ id: "writing-paper", name: "Paper", scope: "genre", genre: "paper" });
const projectSkill = skill({
  id: "work-neikui",
  name: "内窥",
  scope: "project",
  project: "内窥",
  projectPath: "Writing/Novels/内窥",
});

describe("writing skill selection", () => {
  it("selects global, matching genre and project skills in specificity order", () => {
    const selected = selectSkills(
      [globalSkill, genreSkill, otherGenreSkill, projectSkill],
      { feature: "writing", userPrompt: "", writingScope, genre: "novel" },
      settings
    );
    expect(selected.map((item) => item.id)).toEqual(["work-neikui", "writing-webnovel", "writing-craft"]);
  });

  it("does not attach project skills without a matching project", () => {
    const selected = selectSkills(
      [globalSkill, genreSkill, projectSkill],
      { feature: "writing", userPrompt: "", genre: "novel" },
      settings
    );
    expect(selected.map((item) => item.id)).toEqual(["writing-webnovel", "writing-craft"]);
  });

  it("does not inject writing skills outside writing contexts by default", () => {
    expect(selectSkills(
      [globalSkill],
      { feature: "knowledge", userPrompt: "" },
      settings
    )).toEqual([]);
  });

  it("can inject apply: all global skills outside writing when writingOnly is off", () => {
    const all = skill({ id: "all-skill", name: "All", scope: "global", apply: "all" });
    const selected = selectSkills(
      [globalSkill, all],
      { feature: "knowledge", userPrompt: "" },
      { ...settings, writingOnly: false }
    );
    expect(selected.map((item) => item.id)).toEqual(["all-skill"]);
  });

  it("supports attaching project skills in the assistant or annotation features", () => {
    const selected = selectSkills(
      [projectSkill],
      { feature: "annotation", userPrompt: "", writingScope },
      settings
    );
    expect(selected.map((item) => item.id)).toEqual(["work-neikui"]);
  });

  it("honors disabled IDs", () => {
    const selected = selectSkills(
      [globalSkill, projectSkill],
      { feature: "writing", userPrompt: "", writingScope },
      { ...settings, disabledSkillIds: ["work-neikui"] }
    );
    expect(selected.map((item) => item.id)).toEqual(["writing-craft"]);
  });

  it("matches project by folder path prefix or by title", () => {
    const byPath = selectSkills(
      [projectSkill],
      {
        feature: "writing",
        userPrompt: "",
        writingScope: { projectTitle: "Renamed", projectPath: "Writing/Novels/内窥/子目录", genre: "novel" },
      },
      settings
    );
    expect(byPath).toHaveLength(1);

    const byTitle = selectSkills(
      [skill({ id: "title-only", name: "Title only", scope: "project", project: "内窥" })],
      { feature: "writing", userPrompt: "", writingScope },
      settings
    );
    expect(byTitle).toHaveLength(1);
  });

  it("respects the character budget and truncates the first oversized skill", () => {
    const project = skill({
      id: "work-neikui",
      name: "内窥",
      scope: "project",
      project: "内窥",
      body: "P".repeat(100),
    });
    const global = skill({ id: "writing-craft", name: "Craft", scope: "global", body: "G".repeat(100) });
    const selected = selectSkills(
      [global, project],
      { feature: "writing", userPrompt: "", writingScope },
      { ...settings, maxChars: 50 }
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("work-neikui");
    expect(selected[0].body).toContain("[已截断]");
  });
});
