/**
 * What Settings does: keeps the open tab in `?tab=` beside `?view=settings`, so each one can be
 * linked, reads and writes the look this browser keeps, and signs the person out.
 */
import { wording } from "../../config.ts";
import { useTheme } from "@corbits/react-ui";
import { useEffect, useState } from "react";
import {
  useDocumentTips,
  writeDocumentTips,
} from "../../document-tips-setting.ts";
import {
  useQuestionsLayout,
  writeQuestionsLayout,
} from "../../questions-layout-setting.ts";
import type { HubUser } from "../../api/auth.ts";
import type {
  SettingsSlots,
  SettingsTab,
  SettingsViewProps,
} from "./settings.view.tsx";

export type SettingsProps = {
  onChanged: () => void;
  /** Who is signed in; the Account section names them. */
  user?: HubUser | null;
  onUserChanged?: (user: HubUser) => void;
  onSignOut?: () => Promise<void>;
  requestedTab?: SettingsTab;
  focusPreference?: string;
  focusSeq?: number;
};

function isSettingsTab(value: string | null): value is SettingsTab {
  return value !== null && Object.hasOwn(wording.settings.tab, value);
}

function tabInUrl(): SettingsTab {
  if (typeof window === "undefined") return "providers";
  const requested = new URLSearchParams(window.location.search).get("tab");
  return isSettingsTab(requested) ? requested : "providers";
}

function focusInUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const requested = new URLSearchParams(window.location.search).get("focus");
  return requested !== null && requested.length > 0 ? requested : undefined;
}

/** Replaces rather than pushes, so switching tabs never adds a Back step. */
function writeSearch(edit: (search: URLSearchParams) => void): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  edit(url.searchParams);
  window.history.replaceState(window.history.state, "", url);
}

/** Keeps the open tab in the address bar while Settings is shown, and takes
 * back on leaving only the parameters it added. */
function useTabInUrl(
  requestedTab?: SettingsTab,
  focusPreference?: string,
  focusSeq?: number,
): [SettingsTab, (tab: SettingsTab) => void] {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (requestedTab !== undefined) return requestedTab;
    if (focusPreference !== undefined || focusInUrl() !== undefined) {
      return "preferences";
    }
    return tabInUrl();
  });
  useEffect(() => {
    if (requestedTab !== undefined) {
      setActiveTab(requestedTab);
    } else if (focusPreference !== undefined || focusInUrl() !== undefined) {
      setActiveTab("preferences");
    }
  }, [requestedTab, focusPreference, focusSeq]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onPopState = () => setActiveTab(tabInUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const addedView =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("view") !== "settings";
    return () =>
      writeSearch((search) => {
        search.delete("tab");
        search.delete("focus");
        if (addedView && search.get("view") === "settings")
          search.delete("view");
      });
  }, []);
  useEffect(() => {
    writeSearch((search) => {
      search.set("view", "settings");
      search.set("tab", activeTab);
      if (activeTab === "preferences" && focusPreference !== undefined) {
        search.set("focus", focusPreference);
      }
    });
  }, [activeTab, focusPreference, focusSeq]);
  return [activeTab, setActiveTab];
}

export function useSettings({
  user = null,
  onSignOut,
  requestedTab,
  focusPreference,
  focusSeq = 0,
}: SettingsProps): {
  view: Omit<SettingsViewProps, keyof SettingsSlots>;
  /** The preference the person was sent to, for the working preferences section to jump to. */
  workingPreferences: { focusPreference?: string; focusSeq: number };
} {
  const effectiveFocus = focusPreference ?? focusInUrl();
  const [activeTab, setActiveTab] = useTabInUrl(
    requestedTab,
    effectiveFocus,
    focusSeq,
  );
  const { mode, setMode } = useTheme();
  const tips = useDocumentTips();
  const questionsLayout = useQuestionsLayout();
  const [signingOut, setSigningOut] = useState(false);
  const signOut = async (leave: () => Promise<void>) => {
    setSigningOut(true);
    try {
      await leave();
    } finally {
      setSigningOut(false);
    }
  };
  return {
    view: {
      tab: activeTab,
      onTabChange: setActiveTab,
      appearance: {
        theme: mode,
        onThemeChange: setMode,
        documentTips: tips === "on",
        onDocumentTipsChange: (on) => writeDocumentTips(on ? "on" : "off"),
        questionsInSteps: questionsLayout === "steps",
        onQuestionsInStepsChange: (on) =>
          writeQuestionsLayout(on ? "steps" : "all"),
      },
      account: user && {
        name: user.name,
        email: user.email,
        signingOut,
        onSignOut: onSignOut ? () => void signOut(onSignOut) : null,
      },
    },
    workingPreferences: {
      ...(effectiveFocus !== undefined
        ? { focusPreference: effectiveFocus }
        : {}),
      focusSeq,
    },
  };
}
