/** The split between conversation and document, kept in this browser. */
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";

const WIDTH_KEY = "builder-document-pane-width";
const DEFAULT = "";

const parseWidth = (raw: string): string | null =>
  /^\d+$/.test(raw) ? raw : null;

/** The chosen width in px, or `null` for the pane's default. */
export function useDocumentPaneWidth(): number | null {
  const raw = useStoredPreference(WIDTH_KEY, parseWidth, DEFAULT);
  return raw === DEFAULT ? null : Number(raw);
}

export function writeDocumentPaneWidth(width: number | null): void {
  writeStoredPreference(WIDTH_KEY, width === null ? DEFAULT : String(width));
}
