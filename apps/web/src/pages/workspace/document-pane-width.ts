/** The split between conversation and document, kept per project in this browser. */
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";

// Do not inherit the legacy global width: it may come from a wide app preview.
const widthKey = (projectId: string | undefined) =>
  `builder-document-pane-width:${projectId}`;
const DEFAULT = "";

const parseWidth = (raw: string): string | null =>
  /^\d+$/.test(raw) ? raw : null;

/** The chosen width in px, or `null` for the pane's default. */
export function useDocumentPaneWidth(
  projectId: string | undefined,
): number | null {
  const raw = useStoredPreference(widthKey(projectId), parseWidth, DEFAULT);
  return projectId === undefined || raw === DEFAULT ? null : Number(raw);
}

export function writeDocumentPaneWidth(
  projectId: string | undefined,
  width: number | null,
): void {
  if (projectId === undefined) return;
  writeStoredPreference(
    widthKey(projectId),
    width === null ? DEFAULT : String(width),
  );
}
