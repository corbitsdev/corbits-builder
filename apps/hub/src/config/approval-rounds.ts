export type PackageManifestSource = {
  kind: string;
  version: number;
  sha256: string;
  title?: string;
};

export function packageReadme(input: {
  projectTitle: string;
  packageTitle: string;
  version: number;
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
  reviewerName: string;
  persona: string;
  slide?: number;
  text: string;
}): string {
  const slideLabel =
    item.slide === undefined ? "overall" : `slide ${String(item.slide)}`;
  return [
    "Please revise the project to incorporate this reviewer feedback:",
    "",
    `--- reviewer feedback (external, persona: ${item.persona}, reviewer: ${item.reviewerName}, slide: ${slideLabel}) ---`,
    item.text,
    "--- end reviewer feedback ---",
  ].join("\n");
}
