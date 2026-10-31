import { defineTool } from "@intx/agent/authoring";
import { designSkills } from "@corbits-builder/designer/skills" with { type: "macro" };
import { documentSkills } from "@corbits-builder/writer/skills" with { type: "macro" };
import { readSkillDefinition } from "./definitions.ts";
import { readSkill } from "./read-skill.ts";

const SKILLS = { ...designSkills(), ...documentSkills() };

export function createSkillTools(names: readonly string[]) {
  for (const name of names)
    if (!SKILLS[name]) throw new Error(`unknown_skill: ${name}`);
  const definition = readSkillDefinition(SKILLS, names);
  return defineTool({
    id: "@corbits-builder/skills/tools",
    definitions: [{ name: definition.name }],
    factory: () => ({
      definitions: [definition],
      run: async (call) => ({
        callId: call.id,
        ...readSkill(SKILLS, names, call.arguments),
      }),
    }),
  });
}
