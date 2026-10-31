/**
 * Whether the app rail is expanded, kept in this browser. Until the person
 * chooses, a phone-width window starts with the icon rail so the workspace
 * keeps the screen.
 */
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const SIDEBAR_KEY = "builder-sidebar";
const NARROW_QUERY = "(max-width: 640px)";

export type SidebarChoice = "expanded" | "collapsed";

const parseSidebar = (raw: string): SidebarChoice | null =>
  raw === "expanded" || raw === "collapsed" ? raw : null;

export function useSidebar(): SidebarChoice {
  const narrow =
    typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches;
  return useStoredPreference(
    SIDEBAR_KEY,
    parseSidebar,
    narrow ? "collapsed" : "expanded",
  );
}

export function writeSidebar(choice: SidebarChoice): void {
  writeStoredPreference(SIDEBAR_KEY, choice);
}
