import { describeSkill, ReadSkill, type Skills } from "./read-skill.ts";

// Agent Skills disclosed progressively: the tool description lists each skill's name and when to
// use it; a call returns the skill's instructions, or one of the reference files they point to.
export const readSkillDefinition = (
  skills: Skills,
  names: readonly string[],
) => ({
  name: "read_skill",
  description: [
    "Read a skill: tested instructions for one kind of work. Pass name to get its instructions; pass file as well to read one of the reference files they name. A long file comes in numbered parts, and part reads the next one.",
    ...names.map((name) => `- ${name}: ${describeSkill(skills, name)}`),
  ].join("\n"),
  inputSchema: { ...ReadSkill.toJsonSchema() },
});
