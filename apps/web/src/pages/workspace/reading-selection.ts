/** Which document the reading pane shows, and how its heading is lifted out. */
import type { ProjectArtifact } from "@corbits-builder/client";

export function selectedDeliverable(
  deliverables: readonly ProjectArtifact[],
  expandedId: string | null,
): ProjectArtifact | null {
  return (
    deliverables.find((item) => item.kind === expandedId) ??
    deliverables.at(-1) ??
    null
  );
}

/** The document's own first heading, lifted out so it can carry the version menu. Later headings stay. */
export function splitLeadingHeading(content: string): {
  heading: string | null;
  body: string;
} {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let index = 0;
  while (index < lines.length && (lines[index]?.trim() ?? "") === "")
    index += 1;
  const heading = /^#{1,6}\s+(.*?)\s*#*$/.exec(lines[index]?.trim() ?? "")?.[1];
  if (heading === undefined || heading.length === 0)
    return { heading: null, body: content };
  return {
    heading: heading.replace(/[*_`]/g, ""),
    body: lines
      .slice(index + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
}
