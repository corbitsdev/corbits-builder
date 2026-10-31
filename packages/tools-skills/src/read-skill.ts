import { type } from "arktype";

export type Skills = Record<string, Record<string, string>>;

export const ReadSkill = type({
  "+": "reject",
  name: "string > 0",
  "file?": "string > 0",
  "part?": "number.integer > 0",
});
// A tool result over 10000 characters is spilled to a file, so a skill file is read in parts that
// fit; a designer reading back a spilled 12000-character SKILL.md never reached its end.
const PART_CHARS = 8000;

export function describeSkill(skills: Skills, name: string): string {
  const description = skills[name]?.["SKILL.md"]
    ?.match(/^description:\s*(.+)$/m)?.[1]
    ?.trim();
  if (!description) throw new Error(`skill ${name} has no description`);
  return description;
}

export function readSkill(
  skills: Skills,
  names: readonly string[],
  args: unknown,
): { content: string; isError?: true } {
  const input = ReadSkill(args);
  if (input instanceof type.errors)
    return { content: input.summary, isError: true };
  // Writers asked for problem_brief and product_requirements, the document kinds their task
  // names, 13 times in 20 eval runs; a skill is named for its kind with hyphens.
  const name = input.name.replaceAll("_", "-");
  const skill = names.includes(name) ? skills[name] : undefined;
  if (!skill)
    return {
      content: `no skill named ${input.name}; skills: ${names.join(", ")}`,
      isError: true,
    };
  const file = input.file ?? "SKILL.md";
  const content = Object.hasOwn(skill, file) ? skill[file] : undefined;
  if (content === undefined)
    return {
      content: `${input.name} has no file ${file}; files: ${Object.keys(skill).join(", ")}`,
      isError: true,
    };
  const parts = Math.max(1, Math.ceil(content.length / PART_CHARS));
  if (parts === 1) return { content };
  const part = Math.min(input.part ?? 1, parts);
  const slice = content.slice((part - 1) * PART_CHARS, part * PART_CHARS);
  return {
    content:
      part < parts
        ? `${slice}\n[part ${part} of ${parts}; read_skill with part ${part + 1} for the rest]`
        : `${slice}\n[part ${part} of ${parts}, the end]`,
  };
}
