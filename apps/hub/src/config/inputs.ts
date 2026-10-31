// A warmed designer or coder workspace holds the filed documents it works from as read-only files,
// and its hub-built assignment opens by naming them, so it starts from them instead of fetching
// each one (a kept trace's coder made 54 document reads in 107 turns).
export const INPUTS_DIRECTORY = ".inputs";

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

export const DESIGNER_INPUTS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
] as const;
export const CODER_INPUTS = [...DESIGNER_INPUTS, "build_plan"] as const;

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
