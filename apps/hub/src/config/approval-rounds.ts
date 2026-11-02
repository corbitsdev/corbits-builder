export type PackageManifestSource = {
  kind: string;
  version: number;
  sha256: string;
  title?: string;
};

export const DEFAULT_WORKSPACE_REVIEWERS = [
  {
    id: "ws-rev-dana-chen",
    name: "Dana Chen",
    persona: "CEO",
    email: "dana.chen@example.com",
    goal: "Approve Aurora Weather Studio scope, timeline, and Q3 budget to begin the Coder phase",
  },
  {
    id: "ws-rev-marcus-vance",
    name: "Marcus Vance",
    persona: "CTO",
    email: "marcus.vance@example.com",
    goal: "Sign off on radar tile payload budget, latency SLAs, and offline caching architecture",
  },
  {
    id: "ws-rev-priya-patel",
    name: "Priya Patel",
    persona: "VP Product",
    email: "priya.patel@example.com",
    goal: "Confirm user journey, severe alert triage flow, and accessibility targets",
  },
] as const;

export function packageReadme(input: {
  projectTitle: string;
  packageTitle: string;
  version: number;
  reviewer?: { name: string; persona: string };
  audience?: string;
  decision?: string;
  note?: string;
  sources: readonly PackageManifestSource[];
  documents: readonly string[];
}): string {
  const lines = [
    `# ${input.projectTitle} — ${input.packageTitle} (v${String(input.version)})`,
    "",
  ];
  if (input.reviewer !== undefined && input.reviewer.name.trim() !== "") {
    const personaSuffix =
      input.reviewer.persona.trim() === ""
        ? ""
        : ` (${input.reviewer.persona.trim()})`;
    lines.push(
      `Prepared for: ${input.reviewer.name.trim()}${personaSuffix}`,
      "",
    );
  }
  if (input.audience !== undefined && input.audience.trim() !== "") {
    lines.push(`**Audience:** ${input.audience.trim()}`, "");
  }
  if (input.decision !== undefined && input.decision.trim() !== "") {
    lines.push(`**Decision needed:** ${input.decision.trim()}`, "");
  }
  if (input.note !== undefined && input.note.trim() !== "") {
    lines.push(input.note.trim(), "");
  }
  lines.push(
    "## Package Contents",
    "",
    "- `deck.pptx` — Editable presentation deck",
    "- `deck.pdf` — Printable presentation PDF",
    "- `manifest.json` — Pinned source document versions and SHA-256 digests",
  );
  for (const path of input.documents) {
    lines.push(`- \`${path}\` — Supporting project document`);
  }
  if (input.sources.length > 0) {
    lines.push("", "## Grounded Source Manifest", "");
    for (const source of input.sources) {
      const label =
        source.title === undefined
          ? source.kind
          : `${source.title} (${source.kind})`;
      lines.push(
        `- ${label}: v${String(source.version)} (\`${source.sha256}\`)`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function incorporatedFeedbackMessage(item: {
  packageVersion?: number;
  audience?: string;
  reviewerName: string;
  persona: string;
  decision?: string;
  slide?: number;
  text: string;
}): string {
  const slideLabel =
    item.slide === undefined ? "overall" : `slide ${String(item.slide)}`;
  const versionPart =
    item.packageVersion === undefined
      ? ""
      : `package: v${String(item.packageVersion)}, `;
  const audiencePart =
    item.audience === undefined || item.audience.trim() === ""
      ? ""
      : `audience: ${item.audience.trim()}, `;
  const decisionPart =
    item.decision === undefined || item.decision.trim() === ""
      ? ""
      : `, decision: ${item.decision.trim()}`;
  return [
    "Please revise the project to incorporate this reviewer feedback:",
    "",
    `--- reviewer feedback (external, ${versionPart}${audiencePart}persona: ${item.persona}, reviewer: ${item.reviewerName}${decisionPart}, slide: ${slideLabel}) ---`,
    item.text,
    "--- end reviewer feedback ---",
  ].join("\n");
}
