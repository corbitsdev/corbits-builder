/**
 * How the Projects page lays projects out, tiles or a list of one-liners, kept
 * in this browser. Tiles until the person chooses.
 */
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const LIBRARY_VIEW_KEY = "builder-library-view";

/** Tiles, or a list of one line per project. */
export type ViewMode = "grid" | "rows";

export const parseLibraryView = (raw: string): ViewMode | null =>
  raw === "grid" || raw === "rows" ? raw : null;

export function useLibraryView(): ViewMode {
  return useStoredPreference(LIBRARY_VIEW_KEY, parseLibraryView, "grid");
}

export function writeLibraryView(mode: ViewMode): void {
  writeStoredPreference(LIBRARY_VIEW_KEY, mode);
}
