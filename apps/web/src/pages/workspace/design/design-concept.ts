import type { ProjectArtifact } from "@corbits-builder/client";
import { wording } from "../../../config.ts";
import type { DesignFiles } from "./design-bundle.ts";

/** The kind of the document each concept's designer files, titled by its concept. */
export const DESIGN_OPTION = "design_option";

/** A design concept the person compares, and the document pane tab that shows it. */
export type DesignConcept = {
  readonly label: string;
  readonly direction?: string;
  /** The filed option's design bundle. */
  readonly content: string;
  /** The filed option at the version the person sees, which they choose by. */
  readonly option: { readonly artifactId: string; readonly version: number };
  /** The person chose this concept, and its option is the approved design. */
  readonly chosen?: boolean;
};

/** The design a screen reviews, and the design option an approval of it chooses, if any. */
export type ReviewedDesign = {
  files: DesignFiles;
  version: number;
  approval: { option: string } | { unavailable: string };
};

const CONCEPT_TAB = "concept:";

/** The pane tab, and the document id the conversation opens, for one concept. */
export const conceptTab = (label: string) => CONCEPT_TAB + label;
export const conceptOfTab = (id: string) =>
  id.startsWith(CONCEPT_TAB) ? id.slice(CONCEPT_TAB.length) : undefined;

/**
 * How a design on a review screen can be approved. Only an option is approved there: the hub
 * records the choice from the answer.
 */
export function reviewApproval(
  item: ProjectArtifact,
): ReviewedDesign["approval"] {
  if (item.kind === DESIGN_OPTION) return { option: item.artifactId };
  return {
    unavailable:
      item.approvedVersion === item.version
        ? wording.designReview.approved
        : wording.designReview.noOption,
  };
}
