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

/** A leading top-level heading is the document's title, lifted onto the page; a section stays. */
export function splitLeadingHeading(content: string): {
  heading: string | null;
  body: string;
} {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  let index = 0;
  while (lines[index]?.trim() === "") index += 1;
  const first = lines[index]?.trim();
  const heading =
    first === undefined ? undefined : /^#\s+(.*?)\s*#*$/.exec(first)?.[1];
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
