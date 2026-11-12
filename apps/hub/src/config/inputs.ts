// A warmed designer or coder workspace holds the filed documents it works from as read-only files,
// and its hub-built assignment opens by naming them, so it starts from them instead of fetching
// each one (a kept trace's coder made 54 document reads in 107 turns).
import type { SkillPack } from "@corbits-builder/plugin-host/catalog";
import { INPUTS_DIRECTORY } from "@corbits-builder/schemas/app-files";
export { INPUTS_DIRECTORY };

const INPUTS = {
  problem_brief: {
    file: "brief.md",
    use: "the problem, who has it and what success looks like",
  },
  constraints: {
    file: "constraints.md",
    use: "the bounds the app works within and why",
  },
  approaches: {
    file: "approaches.md",
    use: "the chosen way to build it and the alternatives set aside",
  },
  product_requirements: {
    file: "requirements.md",
    use: "what the app must do and for whom",
  },
  build_plan: {
    file: "build-plan.md",
    use: "the stack, the build phases and the acceptance checklist",
  },
} as const;
export type InputKind = keyof typeof INPUTS;
export const isInputKind = (kind: string): kind is InputKind =>
  Object.hasOwn(INPUTS, kind);

export const inputPath = (kind: InputKind) =>
  `${INPUTS_DIRECTORY}/${INPUTS[kind].file}`;

export const KIT_DIGEST = `${INPUTS_DIRECTORY}/react-ui.md`;

// Only the coder has read_artifact; the designer's documents are these files.
export const inputFile = (
  document: { kind: string; version: number; content: string },
  readable: boolean,
) =>
  `Filed ${document.kind}, version ${document.version}.${readable ? " read_artifact returns a newer version when one is filed." : ""}\n\n${document.content}`;

export function startHere(
  documents: readonly { kind: InputKind; version: number }[],
  design?: number,
) {
  const lines = documents.map(
    ({ kind, version }) =>
      `- ${inputPath(kind)}: ${INPUTS[kind].use} (version ${version})`,
  );
  if (design !== undefined)
    lines.push(
      `- .builder/DESIGN.md and the mockup in .builder/designs/: the approved design: its tokens (exact CSS in .builder/designs/styles.css), screens, states and flows (version ${design})`,
      `- ${KIT_DIGEST}: every @corbits/react-ui component the starter installs, with its exact props and import path`,
    );
  return `Start here, read-only in your workspace:\n${lines.join("\n")}\n\n`;
}

// Each skill pack's files sit in its own folder here, a narrowing pack's inside the one it narrows.
export const SKILLS_DIRECTORY = `${INPUTS_DIRECTORY}/skills`;

// One line per pack, so an assignment stays short however many are installed; the agent opens a
// pack's files only when its work calls for them.
export function skillPacksIndex(packs: readonly SkillPack[]) {
  if (packs.length === 0) return "";
  const lines = packs.map(
    ({ builder, path, depth }) =>
      `${"  ".repeat(depth)}- ${builder.handle} (${SKILLS_DIRECTORY}/${path}/): ${builder.when}`,
  );
  return `Skill packs, read-only in your workspace: short guides for one kind of work each; a pack indented under another narrows it. Open a pack only when your work calls for it, and leave the rest unread:\n${lines.join("\n")}\n\n`;
}
