/**
 * Whether the app rail is expanded. On a wide window the person's choice is
 * kept in this browser. At phone width the rail is an icon column and its full
 * form lies over the page, so there it starts closed whatever the wide choice
 * is, opens only when the person opens it, and closes as they go somewhere.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

const SIDEBAR_KEY = "builder-sidebar";
// The phone-width rules in App.module.css use the same width.
const NARROW_QUERY = "(max-width: 640px)";

type SidebarChoice = "expanded" | "collapsed";

const parseSidebar = (raw: string): SidebarChoice | null =>
  raw === "expanded" || raw === "collapsed" ? raw : null;

function subscribeNarrow(changed: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

const readNarrow = () => window.matchMedia(NARROW_QUERY).matches;

export function useSidebar() {
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  const stored = useStoredPreference(SIDEBAR_KEY, parseSidebar, "expanded");
  const [openOverPage, setOpenOverPage] = useState(false);
  useEffect(() => setOpenOverPage(false), [narrow]);
  const collapsed = narrow ? !openOverPage : stored === "collapsed";
  return {
    collapsed,
    toggle: () => {
      if (narrow) setOpenOverPage(collapsed);
      else
        writeStoredPreference(
          SIDEBAR_KEY,
          collapsed ? "expanded" : "collapsed",
        );
    },
    /** The person went somewhere from the rail; at phone width it gets out of the way. */
    leave: () => setOpenOverPage(false),
  };
}
