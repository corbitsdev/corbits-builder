import { wording } from "../../config.ts";
import type { DesignPart } from "./design-preview.view.tsx";
import type { SidebarFile } from "./files-list.tsx";
import { MOCKUP_TAB } from "./tab-follow.ts";

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

/** The filed documents as Files rows, one for each pane, so a design gets a row for its mockup. */
export function fileRows(documents: readonly PaneDocument[]): SidebarFile[] {
  return documents.flatMap((document) =>
    documentViews(document).map((view) => ({
      id: view.value,
      name:
        view.part === undefined
          ? document.title
          : wording.projectShell.designFile[view.part](document.title),
      opens: view.value,
      files: [],
    })),
  );
}
