import { type } from "arktype";
import { defineTool } from "@intx/agent/authoring";

// A plugin's skills, each its files by path, SKILL.md first.
type Skills = Readonly<Record<string, Readonly<Record<string, string>>>>;

const ReadSkill = type({
  "+": "reject",
  name: "string > 0",
  "file?": "string > 0",
  "part?": "number.integer > 0",
});
// A tool result over 10000 characters is spilled to a file, so a skill file is read in parts that
// fit; a designer reading back a spilled 12000-character SKILL.md never reached its end.
const PART_CHARS = 8000;

const describe = (skill: Readonly<Record<string, string>>) =>
  skill["SKILL.md"]?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";

// Agent Skills disclosed progressively: the tool description lists each skill's name and when to
// use it; a call returns the skill's instructions, or one of the reference files they point to.
// The plugin whose agent reads them hands its skills over, built into its package.
export function createSkillTools(skills: Skills) {
  const names = Object.keys(skills);
  const definitions = [
    {
      name: "read_skill",
      description: [
        "Read a skill: tested instructions for one kind of work. Pass name to get its instructions; pass file as well to read one of the reference files they name. A long file comes in numbered parts, and part reads the next one.",
        ...Object.entries(skills).map(
          ([name, skill]) => `- ${name}: ${describe(skill)}`,
        ),
      ].join("\n"),
      inputSchema: { ...ReadSkill.toJsonSchema() },
    },
  ];
  return defineTool({
    id: "@corbits-builder/skills/tools",
    definitions: definitions.map(({ name }) => ({ name })),
    factory: () => ({
      definitions,
      run: async (call) => {
        const input = ReadSkill(call.arguments);
        if (input instanceof type.errors)
          return { callId: call.id, content: input.summary, isError: true };
        // Writers asked for problem_brief and product_requirements, the document kinds their task
        // names, 13 times in 20 eval runs; a skill is named for its kind with hyphens.
        const name = input.name.replaceAll("_", "-");
        const skill = Object.hasOwn(skills, name) ? skills[name] : undefined;
        if (!skill)
          return {
            callId: call.id,
            content: `no skill named ${input.name}; skills: ${names.join(", ")}`,
            isError: true,
          };
        const file = input.file ?? "SKILL.md";
        const content = Object.hasOwn(skill, file) ? skill[file] : undefined;
        if (content === undefined)
          return {
            callId: call.id,
            content: `${input.name} has no file ${file}; files: ${Object.keys(skill).join(", ")}`,
            isError: true,
          };
        const parts = Math.max(1, Math.ceil(content.length / PART_CHARS));
        if (parts === 1) return { callId: call.id, content };
        const part = Math.min(input.part ?? 1, parts);
        const slice = content.slice((part - 1) * PART_CHARS, part * PART_CHARS);
        return {
          callId: call.id,
          content:
            part < parts
              ? `${slice}\n[part ${part} of ${parts}; read_skill with part ${part + 1} for the rest]`
              : `${slice}\n[part ${part} of ${parts}, the end]`,
        };
      },
    }),
  });
}
