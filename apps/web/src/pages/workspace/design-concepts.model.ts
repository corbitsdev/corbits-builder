/**
 * Design concepts the person compares before choosing one: each concept's designer files a
 * design_option titled by the concept, and the concept is there to open once its option is filed.
 */
import type { ProjectArtifact } from "@corbits-builder/client";
import type { DesignConcept } from "./design-concept.ts";

export const DESIGN_OPTION = "design_option";

/**
 * The concepts with a filed option whose design is read, in the order the person was asked about
 * them. Directions come only from the hand-offs this room has seen.
 */
export function designConcepts(
  options: readonly ProjectArtifact[],
  asked: readonly { readonly label: string; readonly direction: string }[],
  content: (option: ProjectArtifact) => string | undefined,
  chosen?: string,
): DesignConcept[] {
  const labels = new Set([
    ...asked.map((concept) => concept.label),
    ...options.map((option) => option.title),
  ]);
  return [...labels].flatMap((label) => {
    const option = options.find((item) => item.title === label);
    const body = option === undefined ? undefined : content(option);
    if (option === undefined || body === undefined) return [];
    const direction = asked.find(
      (concept) => concept.label === label,
    )?.direction;
    return [
      {
        label,
        ...(direction === undefined ? {} : { direction }),
        content: body,
        option: { artifactId: option.artifactId, version: option.version },
        ...(label === chosen ? { chosen: true } : {}),
      },
    ];
  });
}
