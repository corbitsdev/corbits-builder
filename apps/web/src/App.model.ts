/**
 * What the app shell does: the session, which screen is on, the project list
 * and moving between projects.
 *
 * The view state flows down; every mutation goes back through the API and
 * then a refresh, so what the interface shows is what the hub durably holds
 * rather than an optimistic guess.
 */
import { ProductApiError } from "@corbits-builder/client";
import type { ModelProvider } from "@corbits-builder/schemas/models";
import { useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { toast } from "sonner";
import { wording } from "./config.ts";
import { notify } from "./notice.ts";
import {
  ensureWorkspace,
  getHubSession,
  openWorkspace,
  signOutHub,
  workspaceTenantId,
  type HubUser,
} from "./api/auth.ts";
import { listProjects } from "./api/projects.ts";
import { productClient } from "./api/transport.ts";
import { ApiFailure, type ProjectSummary } from "./api/types.ts";
import { queryClient } from "./queries/client.ts";
import { keys } from "./queries/keys.ts";
import { firstRunScreen, type HubAuthState } from "./first-run.ts";
import {
  clearModelSetupDeferral,
  modelSetupDeferred,
  needsModelSetup,
} from "./pages/model-setup.model.ts";
import type { ProjectLibraryProps } from "./pages/project-library.model.ts";
import type { ProjectMenuHost } from "./pages/project-menu.model.ts";
import type { ProjectsProps } from "./pages/projects.model.ts";
import type { SettingsProps } from "./pages/settings/settings.model.ts";
import type { SettingsTab } from "./pages/settings/settings.view.tsx";
import { humanFault, responseCode } from "./pages/workspace/human-fault.ts";
import type { StageWorkspace } from "./pages/workspace/index.tsx";
import {
  inviteInUrl,
  projectInUrl,
  subscribeToHistory,
  writeProjectUrl,
} from "./routes.ts";
import { useSidebar } from "./sidebar-setting.ts";
import { singleFlight } from "./single-flight.ts";
import type {
  AppViewProps,
  BootViewProps,
  ProjectLoadFailureProps,
} from "./App.view.tsx";

/** The page on screen, with what its component takes. */
export type ShellPage =
  | { name: "newProject"; props: ProjectsProps }
  | { name: "library"; props: ProjectLibraryProps }
  | { name: "project"; props: ComponentProps<typeof StageWorkspace> }
  | { name: "noProject" }
  | { name: "projectLoadFailure"; props: ProjectLoadFailureProps }
  | { name: "settings"; props: SettingsProps };

/** The full screen the app shows, with what that screen takes. */
export type AppScreen =
  | { screen: "boot"; offline: boolean }
  | { screen: "auth"; onSignedIn: () => void }
  | { screen: "modelSetup"; onConnected: () => void; onLater: () => void }
  | { screen: "invite"; invitationId: string }
  | {
      screen: "shell";
      view: Omit<AppViewProps, "workspaceMenu" | "projectMenu" | "page">;
      /** What the options menu of a project in the rail needs. */
      menuOf: (projectId: string) => ProjectMenuHost;
      /** Makes another of the person's workspaces the open one. */
      onOpenWorkspace: (workspaceId: string) => void;
      /** Null when the address names no page. */
      page: ShellPage | null;
    };

/** How often the home fold is re-read when nothing nudges it. */
const FOLD_POLL_MS = 30_000;

const NO_PROJECTS: ProjectSummary[] = [];
const NO_PROVIDERS: ModelProvider[] = [];

const readProjects = singleFlight(async () => ({
  projects: await listProjects("all"),
}));

/** What the home fold rests on; `refresh` re-reads all of it at once. */
const FOLD_READS = [keys.modelCatalog, keys.projects, keys.workspaces] as const;

/**
 * Where you are. A project is not a separate destination from its
 * conversation: you open a project and you are in it, with a way back to
 * the list. "projects" is the New project page; "library" lists every
 * project. An invitation link is its own screen, reachable from the
 * invitation's URL.
 */
type View = "projects" | "library" | "project" | "settings" | "invite";

const VIEWS: View[] = ["projects", "library", "project", "settings", "invite"];

/** Each view's place in the shell. An invitation is a screen of its own, so it has none. */
const PLACES: Record<View, AppViewProps["current"]> = {
  projects: "newProject",
  library: "library",
  project: "project",
  settings: "settings",
  invite: null,
};

/** Deep link, so a screen can be opened directly: `/?view=settings`. */
function initialView(): View {
  if (inviteInUrl()) return "invite";
  const requested = new URLSearchParams(window.location.search).get("view");
  if (requested === "settings") return "settings";
  if (projectInUrl()) return "project";
  return VIEWS.includes(requested as View) ? (requested as View) : "projects";
}

/**
 * The view on screen. The path decides whether a project is open (or an
 * invitation is on screen), so Back leaves it and Forward returns.
 */
function viewOnScreen(
  shownView: View,
  urlProject: string | null,
  urlInvite: string | null,
): View {
  if (urlInvite !== null) return "invite";
  // Settings opened over a project wins over the project still in the path.
  if (shownView === "settings") return "settings";
  if (urlProject) return "project";
  return shownView === "project" ? "projects" : shownView;
}

/** The HTTP status a failed read answered with, when it was answered at all. */
function httpStatusOf(failure: Error | null): number | undefined {
  if (failure instanceof ApiFailure) return failure.httpStatus;
  if (
    failure instanceof Error &&
    "response" in failure &&
    failure.response instanceof Response
  )
    return failure.response.status;
  return undefined;
}

/** How the boot screen's wait is going; after a while it admits to taking long. */
export function useBoot(offline: boolean): BootViewProps {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);
  if (offline) return { wait: "offline" };
  return { wait: slow ? "slow" : "starting" };
}

export function useApp(): AppScreen {
  const [shownView, setShownView] = useState<View>(initialView);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    undefined,
  );
  const [focusPreference, setFocusPreference] = useState<string | undefined>(
    undefined,
  );
  const [focusSeq, setFocusSeq] = useState(0);
  const urlProject = useSyncExternalStore(subscribeToHistory, projectInUrl);
  const urlInvite = useSyncExternalStore(subscribeToHistory, inviteInUrl);
  const view = viewOnScreen(shownView, urlProject, urlInvite);
  // Back and Forward re-read the screen from the address, Settings included.
  useEffect(() => subscribeToHistory(() => setShownView(initialView())), []);
  const setView = (next: View) => {
    setError(null);
    writeProjectUrl(next === "project" ? selected : null);
    setShownView(next);
  };
  // Where Settings was opened from, so its back control and the gear's
  // toggle-to-close return there rather than always landing on the projects
  // list.
  const [settingsFrom, setSettingsFrom] = useState<View>("projects");
  const openSettings = (tab?: SettingsTab, focusId?: string) => {
    setSettingsFrom(view === "settings" ? settingsFrom : view);
    setView("settings");
    if (typeof window !== "undefined" && tab !== undefined) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "settings");
      url.searchParams.set("tab", tab);
      if (focusId !== undefined) {
        url.searchParams.set("focus", focusId);
      } else {
        url.searchParams.delete("focus");
      }
      window.history.replaceState(window.history.state, "", url);
    }
    setSettingsTab(tab);
    setFocusPreference(focusId);
    if (tab !== undefined || focusId !== undefined) {
      setFocusSeq((seq) => seq + 1);
    }
  };
  const navigate = (next: View) => {
    if (next === "settings") openSettings();
    else setView(next);
  };
  const closeSettings = () => {
    setSettingsTab(undefined);
    setFocusPreference(undefined);
    setView(settingsFrom === "settings" ? "projects" : settingsFrom);
  };

  const sidebar = useSidebar();
  const [auth, setAuth] = useState<HubAuthState>("unknown");
  const [sessionReadFailed, setSessionReadFailed] = useState(false);

  // A refused read says nothing about what there is, so each query keeps what
  // it last read.
  const providersRead = useQuery({
    queryKey: keys.modelCatalog,
    queryFn: async () =>
      productClient().modelCatalog(await workspaceTenantId()),
    refetchInterval: FOLD_POLL_MS,
    // A signed-out read is a 401, and treating that as "no key" would flash
    // the project list before the real catalog answer.
    enabled: auth === "signed-in",
  });
  const projectsRead = useQuery({
    queryKey: keys.projects,
    queryFn: readProjects,
    refetchInterval: FOLD_POLL_MS,
    enabled: auth === "signed-in",
  });
  const projects = projectsRead.data?.projects ?? NO_PROJECTS;
  const providers = providersRead.data?.providers ?? NO_PROVIDERS;
  const [chosen, setSelected] = useState<string | null>(projectInUrl);
  const selected = urlProject ?? chosen;
  const [error, setError] = useState<string | null>(null);
  // A fold read that failed. A 401/403 means the session cookie no longer
  // holds: that is "not signed in", not "not answering". Only a dropped
  // connection or a real server error is offline: the hub going away is a
  // visible state, not a blank screen.
  const readFailure = providersRead.error ?? projectsRead.error ?? null;
  const readStatus = httpStatusOf(readFailure);
  const signedOutByHost = readStatus === 401 || readStatus === 403;
  // Auth and "no coordinator yet" are not a dead hub. Only a dropped
  // connection or a 5xx is offline.
  const offline =
    sessionReadFailed ||
    (readFailure !== null &&
      !signedOutByHost &&
      (readStatus === undefined || readStatus >= 500));
  // A failed refresh keeps its last data, so only a read that never answered
  // hides the shell.
  const nothingToShow =
    (providersRead.isError && providersRead.data === undefined) ||
    (projectsRead.isError && projectsRead.data === undefined);
  useEffect(() => {
    if (signedOutByHost) setAuth("signed-out");
  }, [signedOutByHost]);
  // Query keys are not scoped to a person, so the cache belongs to whoever was
  // signed in. Clearing it also saves the empty cache over the stored one.
  useEffect(() => {
    if (auth !== "signed-out") return;
    queryClient.clear();
    setSelected(null);
  }, [auth]);
  const [setupLater, setSetupLater] = useState(modelSetupDeferred);
  const [user, setUser] = useState<HubUser | null>(null);
  useEffect(() => {
    if (auth !== "signed-in") {
      setUser(null);
      return;
    }
    let cancelled = false;
    const readUser = async () => {
      try {
        const session = await getHubSession();
        if (!cancelled) setUser(session?.user ?? null);
      } catch (cause) {
        if (cancelled) return;
        // A hub that is down or unreachable is the loading screen's to show, never a toast.
        if (cause instanceof ApiFailure && cause.detail.retryable) return;
        toast.error(humanFault(cause, wording.auth.accountUnreadable));
      }
    };
    void readUser();
    return () => {
      cancelled = true;
    };
  }, [auth]);
  const signOut = async () => {
    try {
      await signOutHub();
    } catch (cause) {
      // The session is ended locally either way; the person hears the hub kept it.
      toast.error(humanFault(cause, wording.auth.signOutFailed));
    }
    setUser(null);
    setAuth("signed-out");
  };

  // Re-reads everything the fold rests on: the first read, every write that
  // may have changed the list, and the conversation's own nudges.
  const refresh = useCallback(async () => {
    await Promise.all(
      FOLD_READS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey, exact: true }),
      ),
    );
  }, []);

  // Another workspace is another tenant: nothing read under the last one
  // holds, and its own first-run setup (a model key) is asked for again.
  const switchWorkspace = (workspaceId: string) => {
    openWorkspace(workspaceId);
    clearModelSetupDeferral();
    setSetupLater(false);
    setSelected(null);
    setView("projects");
    void queryClient.resetQueries();
  };

  useEffect(() => {
    const readSession = async () => {
      try {
        const session = await getHubSession();
        setAuth(session ? "signed-in" : "signed-out");
      } catch (cause) {
        if (!(cause instanceof ApiFailure)) throw cause;
        setSessionReadFailed(true);
      }
    };
    void readSession();
  }, []);

  // The workspace tenant is created the first time this session signs in; the
  // fold reads below all scope themselves with it, so they wait for it.
  useEffect(() => {
    if (auth !== "signed-in") return;
    const setUpWorkspace = async () => {
      try {
        await ensureWorkspace();
        await refresh();
      } catch (cause) {
        setError(humanFault(cause, wording.workspace.setupFailed));
      }
    };
    void setUpWorkspace();
  }, [auth, refresh]);

  // The summary of the open project, from the list read; null when none or
  // not found (a deep link to a project this workspace does not hold).
  const openProjectSummary =
    projects.find((project) => project.id === selected) ?? null;
  // The list on screen can predate the project: home read it, then the
  // project was created, then its path opened. That read is not proof the
  // project is missing. Read the list once more before saying it could not
  // be opened. The poll would get there; the person should not wait for it.
  const [settledMissId, setSettledMissId] = useState<string | null>(null);
  const recheckedListFor = useRef<string | null>(null);
  useEffect(() => {
    recheckedListFor.current = null;
    setSettledMissId(null);
  }, [selected]);
  useEffect(() => {
    if (view !== "project" || selected === null) return;
    if (projects.some((project) => project.id === selected)) return;
    if (!projectsRead.isSuccess || projectsRead.isFetching) return;
    if (recheckedListFor.current === selected) return;
    recheckedListFor.current = selected;
    const id = selected;
    const recheck = async () => {
      try {
        await projectsRead.refetch();
      } finally {
        setSettledMissId(id);
      }
    };
    void recheck();
  }, [
    view,
    selected,
    projects,
    projectsRead.isSuccess,
    projectsRead.isFetching,
    projectsRead.refetch,
  ]);
  // Nothing is decided until the hub has answered. Rendering the app shell
  // while the list is still empty and correcting a moment later is how a
  // first launch flashes the wrong screen — open the most recent project.
  useEffect(() => {
    if (selected !== null || projects.length === 0) return;
    const next = projects[0]?.id;
    if (next) setSelected(next);
  }, [projects, selected]);

  const openProject = (projectId: string, openingMessage?: string) => {
    writeProjectUrl(projectId);
    setSelected(projectId);
    setShownView("project");
    if (openingMessage !== undefined)
      setOpening({ projectId, text: openingMessage });
  };
  // The composer's opening sentence, handed to the workspace to show until the
  // conversation records it. It belongs to the project it started, so switching
  // to another project never carries it over.
  const [opening, setOpening] = useState<{
    projectId: string;
    text: string;
  } | null>(null);
  const openingMessage =
    opening !== null && opening.projectId === selected
      ? opening.text
      : undefined;

  const reportRefusal = async (cause: ProductApiError) => {
    const code = await responseCode(cause);
    const refused =
      code === undefined ? undefined : wording.library.refused[code];
    toast.error(refused ?? humanFault(cause, wording.library.actionFailed));
    void refresh();
  };
  const reportProjectError = (cause: unknown) => {
    if (cause instanceof ApiFailure) toast.error(cause.detail.message);
    else if (cause instanceof ProductApiError) void reportRefusal(cause);
    else void refresh();
  };

  const screen = firstRunScreen({ auth });
  if (screen === "boot") return { screen: "boot", offline };
  if (screen === "auth")
    return { screen: "auth", onSignedIn: () => setAuth("signed-in") };

  // No model credential yet: ask on its own screen, before the project list.
  // A refused read stays on the shell, which already says the hub is down.
  const modelCatalogUnsettled =
    !setupLater && view !== "invite" && providersRead.isPending;
  if (modelCatalogUnsettled || (offline && nothingToShow))
    return { screen: "boot", offline };
  if (
    view !== "invite" &&
    providersRead.data !== undefined &&
    needsModelSetup(providers) &&
    !setupLater
  )
    return {
      screen: "modelSetup",
      onConnected: () => void refresh(),
      onLater: () => setSetupLater(true),
    };

  if (view === "invite" && urlInvite !== null)
    return { screen: "invite", invitationId: urlInvite };

  const inProject = view === "project" && openProjectSummary !== null;
  // A shipped project stays listed while open, so its options menu stays reachable. An archived
  // one lives only under Projects; its workspace banner restores it.
  const listed = projects
    .filter(
      (item) =>
        !item.archivedAt &&
        (item.stage !== "shipped" ||
          (inProject && item.id === openProjectSummary.id)),
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  const menuOf = (projectId: string): ProjectMenuHost => ({
    project: listed.find((item) => item.id === projectId)!,
    onChanged: () => void refresh(),
    onError: reportProjectError,
    onNotice: notify,
    ...(inProject && projectId === openProjectSummary.id
      ? {
          onDeleted: () => {
            setSelected(null);
            navigate("projects");
            void refresh();
          },
        }
      : {}),
  });

  const page = (): ShellPage | null => {
    if (view === "projects")
      return {
        name: "newProject",
        props: {
          onOpen: openProject,
          onChanged: refresh,
          needsProvider:
            providersRead.data !== undefined && needsModelSetup(providers),
        },
      };
    if (view === "library")
      return {
        name: "library",
        props: {
          projects,
          loaded: projectsRead.data !== undefined,
          failed: projectsRead.isError,
          onOpen: (projectId) => openProject(projectId),
          onNewProject: () => navigate("projects"),
          onChanged: () => void refresh(),
          onError: reportProjectError,
          onNotice: notify,
        },
      };
    if (view === "settings")
      return {
        name: "settings",
        props: {
          onChanged: refresh,
          user,
          onUserChanged: setUser,
          onSignOut: signOut,
          ...(settingsTab !== undefined ? { requestedTab: settingsTab } : {}),
          ...(focusPreference !== undefined ? { focusPreference } : {}),
          focusSeq,
        },
      };
    if (view !== "project") return null;
    if (selected === null) return { name: "noProject" };
    if (settledMissId === selected && openProjectSummary === null)
      return {
        name: "projectLoadFailure",
        props: {
          detail: wording.projectLoadFailure.notListed,
          onRetry: () => void refresh(),
          onBackToProjects: () => navigate("projects"),
        },
      };
    return {
      name: "project",
      props: {
        projectId: selected,
        projectTitle:
          openProjectSummary?.title ?? wording.shell.untitledProject,
        ...(openProjectSummary === null
          ? {}
          : { listedArchived: openProjectSummary.archivedAt !== null }),
        onChanged: refresh,
        onOpenSettings: openSettings,
        ...(openingMessage !== undefined ? { openingMessage } : {}),
      },
    };
  };

  return {
    screen: "shell",
    view: {
      current: PLACES[view],
      rail: {
        collapsed: sidebar.collapsed,
        onToggleCollapsed: sidebar.toggle,
        onNewProject: () => {
          sidebar.leave();
          navigate("projects");
        },
        onLibrary: () => {
          sidebar.leave();
          navigate("library");
        },
        onBack: () => {
          sidebar.leave();
          closeSettings();
        },
        onSettings: () => {
          sidebar.leave();
          if (view === "settings") closeSettings();
          else navigate("settings");
        },
        projects: listed.map((item) => ({
          id: item.id,
          title: item.title,
          open: inProject && item.id === openProjectSummary.id,
        })),
        onOpenProject: (projectId) => {
          sidebar.leave();
          openProject(projectId);
        },
      },
      hub: { state: offline ? "notAnswering" : "answering" },
      setupFault: error,
      onOpenPreferences: (preferenceId) =>
        openSettings(
          "preferences",
          preferenceId ?? wording.whatsNew.features.approvals.id,
        ),
    },
    menuOf,
    onOpenWorkspace: switchWorkspace,
    page: page(),
  };
}
