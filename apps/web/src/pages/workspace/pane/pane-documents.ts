import type { ProjectArtifact } from "@corbits-builder/client";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import { inShort } from "@corbits-builder/schemas/in-short";
import { wording } from "../../../config.ts";
import type { DeliverableState } from "./deliverable-block.tsx";
import { DESIGN_OPTION } from "../design/design-concept.ts";
import type { DesignPart } from "../design/design-preview.view.tsx";
import type { ShownDocument } from "../screens/screen-question.tsx";
import type { SeenVersions } from "./seen-versions.ts";
import { MOCKUP_TAB } from "../tab-follow.ts";

/** A filed document as the pane shows it. */
export type PaneDocument = {
  /** Names its pane: the document's kind, or an attached file's own id. */
  id: string;
  title: string;
  /** Where it stands, in words: drafted at a version, or approved at one. */
  status: string;
  /** Its current version is one this viewer has not opened. */
  unread: boolean;
  /** A document the person can approve as they read it, with the version approved and when. */
  approval?: {
    approvedVersion: number | undefined;
    approvedAt: string | undefined;
  };
};

// Each document's panes: one per document, two for the design.
export function documentViews(
  item: PaneDocument,
): { value: string; label: string; part?: DesignPart }[] {
  const label = wording.documentTab[item.id] ?? item.title;
  if (item.id !== "design") return [{ value: item.id, label }];
  return [
    { value: item.id, label, part: "plan" },
    { value: MOCKUP_TAB, label: wording.design.mockupTab, part: "mockup" },
  ];
}

// Every material shares one kind, but each file is its own tab, so the pane names it by its artifact.
const MATERIAL = "material";
const MATERIAL_TAB = `${MATERIAL}:`;

const APPROVAL_PACKAGE = "approval_package";

/** The filed artifacts as the pane names them, each material by its own file. */
export function paneArtifacts(
  artifacts: readonly ProjectArtifact[],
): ProjectArtifact[] {
  // The coder's filed app source is the resume point for a later coder, not a document to read.
  return artifacts
    .filter((item) => item.kind !== "app")
    .map((item) =>
      item.kind === MATERIAL
        ? { ...item, kind: `${MATERIAL_TAB}${item.artifactId}` }
        : item,
    );
}

/** A pane artifact as it was filed, so a material reads the document loaded under its own kind. */
export function filedArtifact(item: ProjectArtifact): ProjectArtifact {
  return item.kind.startsWith(MATERIAL_TAB)
    ? { ...item, kind: MATERIAL }
    : item;
}

/**
 * The filed artifacts that are the pane's documents: a concept's option has a tab of its own, and
 * an approval package is one only while stakeholder approvals are on.
 */
export function tabbedArtifacts(
  artifacts: readonly ProjectArtifact[],
  approvals: "on" | "off",
): ProjectArtifact[] {
  return artifacts.filter(
    (item) =>
      item.kind !== DESIGN_OPTION &&
      (approvals === "on" || item.kind !== APPROVAL_PACKAGE),
  );
}

/**
 * A filed artifact as its tab shows it, at its newest version, unread while this viewer has not
 * opened that version.
 */
export function paneDocument(
  item: ProjectArtifact,
  seen: SeenVersions,
): PaneDocument {
  return {
    id: item.kind,
    title: item.title,
    status:
      item.approvedVersion === undefined
        ? wording.documentStatus.drafted(item.version)
        : wording.documentStatus.approved(item.version),
    unread: seen[item.artifactId] !== item.version,
    ...(isDocumentKind(item.kind)
      ? {
          approval: {
            approvedVersion: item.approvedVersion,
            approvedAt: item.approvedAt,
          },
        }
      : {}),
  };
}

/** A filed document as an approval lists it, with its In short section once its body has loaded. */
export function shownDocument(
  item: ProjectArtifact,
  state: DeliverableState | undefined,
): ShownDocument {
  const summary =
    state?.status === "ready" && state.document.mediaType === "text/markdown"
      ? inShort(state.document.content)
      : undefined;
  return summary === undefined ? item : { ...item, summary };
}

// A screen that shows more of the design takes the mockup's place.
export const documentTab = (id: string) => (id === "design" ? MOCKUP_TAB : id);
