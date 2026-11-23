/**
 * Whether the sidebar is open, in a project and outside one alike. On a wide
 * window the person's choice is kept in this browser. Below the width a
 * project's room makes its sidebar a drawer, the sidebar outside a project is
 * one too: it starts shut whatever the wide choice is, opens only when the
 * person opens it, and shuts again as they go somewhere.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useStoredPreference,
  writeStoredPreference,
} from "./stored-preference.ts";

/** The open or closed sidebar, in this browser; a project's room keeps it here too. */
export const SIDEBAR_KEY = "builder-project-sidebar";

// The width below which a project's room makes its sidebar a drawer.
const NARROW_QUERY = "(max-width: 899px)";

export const parseSidebarOpen = (raw: string): "open" | "closed" | null =>
  raw === "open" || raw === "closed" ? raw : null;

function subscribeNarrow(changed: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

const readNarrow = () => window.matchMedia(NARROW_QUERY).matches;

export function useSidebar() {
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  const stored = useStoredPreference(SIDEBAR_KEY, parseSidebarOpen, "open");
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [narrow]);
  return {
    open: narrow ? drawerOpen : stored === "open",
    /** The window is narrow, so the open sidebar lies over the page. */
    drawer: narrow,
    toggle: () => {
      if (narrow) setDrawerOpen(!drawerOpen);
      else
        writeStoredPreference(
          SIDEBAR_KEY,
          stored === "open" ? "closed" : "open",
        );
    },
    /** The person went somewhere from the sidebar; as a drawer it gets out of the way. */
    leave: () => setDrawerOpen(false),
  };
}
