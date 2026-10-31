/**
 * The app shell.
 *
 * The view state flows down; every mutation goes back through the API and
 * then a refresh, so what the interface shows is what the hub durably holds
 * rather than an optimistic guess.
 *
 * The rail on the left carries navigation only: what the project is doing
 * shows in the workspace.
 */
import { wording } from "./config.ts";
import { humanFault, responseCode } from "./pages/workspace/human-fault.ts";
import { ProductApiError } from "@corbits-builder/client";
import { queryClient } from "./queries/client.ts";
import { keys } from "./queries/keys.ts";
import { hostLatency, productClient } from "./api/transport.ts";
import { useQuery } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { listProjects } from "./api/projects.ts";
import { ApiFailure, type ProjectSummary } from "./api/types.ts";
import { singleFlight } from "./single-flight.ts";
import type { ModelProvider } from "@corbits-builder/schemas/models";
import {
  ArrowLeft,
  Ellipsis,
  LayoutGrid,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  Banner,
  Button,
  Mark,
  notify,
  type NoticeAction,
} from "./components.jsx";
import { Projects } from "./pages/projects.jsx";
import { ProjectMenu } from "./pages/project-menu.jsx";
import { ProjectLibrary } from "./pages/project-library.jsx";
import {
  ensureWorkspace,
  getHubSession,
  openWorkspace,
  signOutHub,
  workspaceTenantId,
  type HubUser,
} from "./api/auth.ts";
import { WorkspaceMenu } from "./workspace-menu.tsx";
import { Settings } from "./pages/settings.jsx";
import {
  Avatar,
  BootScreen,
  Button as UiButton,
  Sidebar,
  SidebarCollapseToggle,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarItemRow,
  SidebarSection,
  useTheme,
} from "@corbits/react-ui";
import { Auth } from "./pages/auth.jsx";
import { StageWorkspace } from "./pages/workspace.jsx";
import { firstRunScreen, type HubAuthState } from "./first-run.ts";
import {
  ModelSetup,
  clearModelSetupDeferral,
  modelSetupDeferred,
  needsModelSetup,
} from "./pages/model-setup.tsx";
import { FineMode } from "./flourish.tsx";
import { InvitationAccept } from "./pages/invite-accept.jsx";
import {
  inviteInUrl,
  projectInUrl,
  subscribeToHistory,
  writeProjectUrl,
} from "./routes.ts";
import { useSidebar, writeSidebar } from "./sidebar-setting.ts";

/** Above this average, the window says the host is slow. */
const SLOW_HOST_MS = 1_500;

/** The host's recent average request time when it is slow, else null; re-read every few seconds. */
function useSlowHost(): number | null {
  const [slow, setSlow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const latency = hostLatency();
      setSlow(
        latency.samples >= 3 && latency.averageMs >= SLOW_HOST_MS
          ? Math.round(latency.averageMs)
          : null,
      );
    };
    tick();
    const timer = setInterval(tick, 5_000);
    return () => clearInterval(timer);
  }, []);
  return slow;
}

/** How often the home fold is re-read when nothing nudges it. */
const FOLD_POLL_MS = 30_000;
/**
 * Where you are. A project is not a separate destination from its
 * conversation: you open a project and you are in it, with a way back to
 * the list. "projects" is the New project page; "library" lists every
 * project. An invitation link is its own screen, reachable from the
 * invitation's URL.
 */
type View = "projects" | "library" | "project" | "settings" | "invite";

const VIEWS: View[] = ["projects", "library", "project", "settings", "invite"];

/** Deep link, so a screen can be opened directly: `/?view=settings`. */
function initialView(): View {
  if (inviteInUrl()) return "invite";
  const requested = new URLSearchParams(window.location.search).get("view");
  if (requested === "settings") return "settings";
  if (projectInUrl()) return "project";
  return VIEWS.includes(requested as View) ? (requested as View) : "projects";
}

/**
 * The first moments, before the hub has said anything.
 *
 * Deliberately not a spinner over a half-built layout: there is no layout yet,
 * because which one is right is exactly what is unknown. One line, and after a
 * while an admission that it is taking longer than it should.
 */
function Booting({ offline }: { offline: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <BootScreen
      message={
        offline
          ? wording.loading
          : slow
            ? wording.boot.slow
            : wording.boot.starting
      }
      brand={<Mark size={26} />}
      footer={
        <a href={wording.builtBy.href} target="_blank" rel="noreferrer">
          {wording.builtBy.label}
        </a>
      }
    />
  );
}

/**
 * A failed project conversation load: plain language and a way out first, the
 * raw cause behind a disclosure rather than in a red box.
 */
function ProjectLoadFailure({
  detail,
  onRetry,
  onBackToProjects,
}: {
  detail: string;
  onRetry: () => void;
  onBackToProjects: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyDetail = () => {
    void navigator.clipboard
      .writeText(detail)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access can be denied; the text is still selectable in the disclosure.
      });
  };

  return (
    <div className="project-load-failure">
      <p className="project-load-failure-title">
        {wording.projectLoadFailure.title}
      </p>
      <p>{wording.projectLoadFailure.lead}</p>
      <div className="project-load-failure-actions">
        <Button variant="primary" onClick={onBackToProjects}>
          {wording.projectLoadFailure.back}
        </Button>
        <Button variant="secondary" onClick={onRetry}>
          {wording.action.tryAgain}
        </Button>
      </div>
      <details className="project-load-failure-details">
        <summary>{wording.projectLoadFailure.details}</summary>
        <pre>{detail}</pre>
        <Button variant="outline" onClick={copyDetail}>
          {copied
            ? wording.projectLoadFailure.copied
            : wording.projectLoadFailure.copy}
        </Button>
      </details>
    </div>
  );
}

// The library's collapsed-rail label class: a project row's name hides
// in the icon rail exactly as a SidebarItem's does.
const RAIL_LABEL_CLASS = "group-data-[collapsed=true]/sidebar:sr-only";

/**
 * The rail down the left.
 *
 * A new project and the Projects page, then, under a rule, the projects still
 * in progress, most recent first, with the open one marked and its options
 * menu on it, above; Settings, which holds the account, below.
 * Collapsed, it is an icon rail that keeps every control and its name; the
 * choice is kept per browser.
 */
function AppSidebar({
  view,
  project,
  projects,
  onOpenProject,
  onNavigate,
  onSettingsClose,
  onProjectChanged,
  onProjectDeleted,
  onNotice,
  onError,
  onOpenWorkspace,
}: {
  view: View;
  project: ProjectSummary | null;
  /** Every project in the workspace; archived ones are left out, shipped ones unless open. */
  projects: readonly ProjectSummary[];
  onOpenProject: (projectId: string) => void;
  onNavigate: (view: View) => void;
  /** Returns to wherever Settings was opened from. */
  onSettingsClose: () => void;
  onProjectChanged: () => void;
  onProjectDeleted: () => void;
  onNotice: (
    message: string,
    complete?: boolean,
    action?: NoticeAction,
  ) => void;
  onError: (cause: unknown) => void;
  /** Makes another of the person's workspaces the open one. */
  onOpenWorkspace: (workspaceId: string) => void;
}) {
  const collapsed = useSidebar() === "collapsed";
  const inProject = view === "project" && project !== null;
  const inSettings = view === "settings";
  // A shipped project stays listed while open, so its options menu stays reachable. An archived
  // one lives only under Projects; its workspace banner restores it.
  const listed = projects
    .filter(
      (item) =>
        !item.archivedAt &&
        (item.stage !== "shipped" || (inProject && item.id === project.id)),
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return (
    <Sidebar id="app-sidebar" className="app-sidebar" collapsed={collapsed}>
      <SidebarHeader>
        <WorkspaceMenu onOpen={onOpenWorkspace} />
        <SidebarCollapseToggle
          collapsed={collapsed}
          onToggle={() => writeSidebar(collapsed ? "expanded" : "collapsed")}
        />
      </SidebarHeader>
      <SidebarContent>
        <ul className="app-sidebar-list">
          <SidebarItem asChild active={view === "projects"} icon={<Plus />}>
            <button
              type="button"
              className="app-sidebar-new"
              onClick={() => onNavigate("projects")}
            >
              {wording.shell.newProject}
            </button>
          </SidebarItem>
          <SidebarItem
            asChild
            active={view === "library"}
            icon={<LayoutGrid />}
          >
            <button type="button" onClick={() => onNavigate("library")}>
              {wording.shell.projects}
            </button>
          </SidebarItem>
          {inSettings ? (
            <SidebarItem asChild icon={<ArrowLeft />}>
              <button type="button" onClick={onSettingsClose}>
                {wording.shell.back}
              </button>
            </SidebarItem>
          ) : null}
        </ul>
        {listed.length > 0 ? (
          <SidebarSection
            label={wording.shell.inProgress}
            className="app-sidebar-projects"
          >
            {listed.map((item) => {
              const open = inProject && item.id === project.id;
              return (
                <SidebarItemRow
                  key={item.id}
                  selected={open}
                  onSelect={() => onOpenProject(item.id)}
                  leading={
                    <Avatar
                      className="app-sidebar-initial"
                      initials={item.title.trim().charAt(0)}
                      label={item.title}
                      shape="square"
                      size="xs"
                    />
                  }
                  name={<span className={RAIL_LABEL_CLASS}>{item.title}</span>}
                  action={
                    <ProjectMenu
                      project={item}
                      align="start"
                      trigger={
                        <UiButton
                          variant="ghost"
                          size="icon"
                          className="app-sidebar-row-menu"
                          aria-label={wording.shell.projectOptions(item.title)}
                        >
                          <Ellipsis aria-hidden="true" />
                        </UiButton>
                      }
                      onChanged={onProjectChanged}
                      onError={onError}
                      onNotice={onNotice}
                      {...(open ? { onDeleted: onProjectDeleted } : {})}
                    />
                  }
                />
              );
            })}
          </SidebarSection>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <ul className="app-sidebar-list">
          <SidebarItem asChild active={inSettings} icon={<SettingsIcon />}>
            <button
              type="button"
              aria-pressed={inSettings}
              onClick={() =>
                inSettings ? onSettingsClose() : onNavigate("settings")
              }
            >
              {wording.shell.settings}
            </button>
          </SidebarItem>
        </ul>
      </SidebarFooter>
    </Sidebar>
  );
}

export function App() {
  const { resolvedMode } = useTheme();
  const [shownView, setShownView] = useState<View>(initialView);
  // The path decides whether a project is open (or an invitation is on
  // screen), so Back leaves it and Forward returns.
  const urlProject = useSyncExternalStore(subscribeToHistory, projectInUrl);
  const urlInvite = useSyncExternalStore(subscribeToHistory, inviteInUrl);
  // Settings opened over a project wins over the project still in the path.
  const view: View =
    urlInvite !== null
      ? "invite"
      : shownView === "settings"
        ? "settings"
        : urlProject
          ? "project"
          : shownView === "project"
            ? "projects"
            : shownView;
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
  const openSettings = () => {
    setSettingsFrom(view === "settings" ? "projects" : view);
    setView("settings");
  };
  const navigate = (next: View) => {
    if (next === "settings") openSettings();
    else setView(next);
  };
  const closeSettings = () =>
    setView(settingsFrom === "settings" ? "projects" : settingsFrom);

  const slowHost = useSlowHost();
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
  const readStatus =
    readFailure instanceof ApiFailure
      ? readFailure.httpStatus
      : readFailure instanceof Error &&
          "response" in readFailure &&
          readFailure.response instanceof Response
        ? readFailure.response.status
        : undefined;
  const signedOutByHost = readStatus === 401 || readStatus === 403;
  // Auth and "no coordinator yet" are not a dead hub. Only a dropped
  // connection or a 5xx is offline.
  const offline =
    sessionReadFailed ||
    (readFailure !== null &&
      !signedOutByHost &&
      (readStatus === undefined || readStatus >= 500));
  useEffect(() => {
    if (signedOutByHost) setAuth("signed-out");
  }, [signedOutByHost]);
  const [setupLater, setSetupLater] = useState(modelSetupDeferred);
  const [user, setUser] = useState<HubUser | null>(null);
  useEffect(() => {
    if (auth !== "signed-in") {
      setUser(null);
      return;
    }
    let cancelled = false;
    void getHubSession()
      .then((session) => {
        if (!cancelled) setUser(session?.user ?? null);
      })
      .catch((cause: unknown) => {
        // A dropped connection is the loading screen's to show, never a toast.
        if (!cancelled && cause instanceof ApiFailure)
          toast.error(humanFault(cause, wording.auth.accountUnreadable));
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);
  const signOut = async () => {
    try {
      await signOutHub();
    } catch {
      // The session is ended locally either way.
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
    void getHubSession()
      .then((session) => setAuth(session ? "signed-in" : "signed-out"))
      .catch(() => setSessionReadFailed(true));
  }, []);

  // The workspace tenant is created the first time this session signs in; the
  // fold reads below all scope themselves with it, so they wait for it.
  useEffect(() => {
    if (auth !== "signed-in") return;
    void ensureWorkspace()
      .then(() => refresh())
      .catch((cause: unknown) =>
        setError(humanFault(cause, wording.workspace.setupFailed)),
      );
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
    void projectsRead.refetch().finally(() => {
      setSettledMissId(id);
    });
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

  const reportProjectError = (cause: unknown) => {
    if (cause instanceof ApiFailure) toast.error(cause.detail.message);
    else if (cause instanceof ProductApiError)
      void responseCode(cause).then((code) => {
        toast.error(
          wording.library.refused[code ?? ""] ??
            humanFault(cause, wording.library.actionFailed),
        );
        void refresh();
      });
    else void refresh();
  };

  const screen = firstRunScreen({ auth });
  if (screen === "boot") {
    return <Booting offline={offline} />;
  }
  if (screen === "auth") {
    return (
      <Auth
        onSignedIn={() => {
          setAuth("signed-in");
        }}
      />
    );
  }

  // No model credential yet: ask on its own screen, before the project list.
  // A refused read stays on the shell, which already says the hub is down.
  const modelCatalogUnsettled =
    !setupLater &&
    view !== "invite" &&
    !providersRead.isSuccess &&
    (providersRead.isPending || providersRead.isFetching);
  if (modelCatalogUnsettled || offline) {
    return <Booting offline={offline} />;
  }
  if (
    view !== "invite" &&
    providersRead.isSuccess &&
    needsModelSetup(providers) &&
    !setupLater
  ) {
    return (
      <ModelSetup
        onConnected={() => void refresh()}
        onLater={() => setSetupLater(true)}
      />
    );
  }

  if (view === "invite" && urlInvite !== null) {
    return (
      <>
        <InvitationAccept invitationId={urlInvite} />
        <Toaster theme={resolvedMode} richColors closeButton />
      </>
    );
  }

  return (
    <>
      <div className="app">
        <AppSidebar
          view={view}
          project={openProjectSummary}
          projects={projects}
          onOpenProject={(projectId) => openProject(projectId)}
          onNavigate={navigate}
          onSettingsClose={closeSettings}
          onProjectChanged={() => void refresh()}
          onProjectDeleted={() => {
            setSelected(null);
            navigate("projects");
            void refresh();
          }}
          onNotice={notify}
          onOpenWorkspace={switchWorkspace}
          onError={reportProjectError}
        />

        <main className="canvas">
          <div
            className={
              view === "project" ? "canvas-body is-fill" : "canvas-body"
            }
          >
            {offline ? (
              <Banner tone="error" title={wording.hub.notAnswering} />
            ) : slowHost ? (
              // Said rather than left to be wondered about: every
              // request on this page waits on the hub, and the hub's own log
              // names which requests are slow.
              <Banner tone="warning" title={wording.hub.slowTitle(slowHost)}>
                {wording.hub.slowLead}
              </Banner>
            ) : null}

            {error ? (
              <Banner tone="error" title={wording.workspace.setupIncomplete}>
                {error}
              </Banner>
            ) : null}

            {view === "projects" ? (
              <Projects
                onOpen={openProject}
                onChanged={refresh}
                needsProvider={
                  providersRead.isSuccess && needsModelSetup(providers)
                }
              />
            ) : null}

            {view === "library" ? (
              <ProjectLibrary
                projects={projects}
                loaded={projectsRead.isSuccess}
                failed={projectsRead.isError}
                onOpen={(projectId) => openProject(projectId)}
                onNewProject={() => navigate("projects")}
                onChanged={() => void refresh()}
                onError={reportProjectError}
                onNotice={notify}
              />
            ) : null}

            {view === "project" ? (
              selected !== null &&
              settledMissId === selected &&
              openProjectSummary === null ? (
                <ProjectLoadFailure
                  detail={wording.projectLoadFailure.notListed}
                  onRetry={() => void refresh()}
                  onBackToProjects={() => navigate("projects")}
                />
              ) : selected !== null ? (
                <StageWorkspace
                  key={selected}
                  projectId={selected}
                  projectTitle={
                    openProjectSummary?.title ?? wording.shell.untitledProject
                  }
                  {...(openProjectSummary === null
                    ? {}
                    : {
                        listedArchived: openProjectSummary.archivedAt !== null,
                      })}
                  onChanged={refresh}
                  onOpenSettings={openSettings}
                  {...(openingMessage !== undefined ? { openingMessage } : {})}
                />
              ) : (
                <div className="project-load-failure">
                  <p className="project-load-failure-title">
                    {wording.shell.noProjectTitle}
                  </p>
                  <p>{wording.shell.noProjectLead}</p>
                </div>
              )
            ) : null}

            {view === "settings" ? (
              <Settings
                onChanged={refresh}
                user={user}
                onUserChanged={setUser}
                onSignOut={signOut}
              />
            ) : null}
          </div>
        </main>
      </div>
      {/* Outside the .app grid: its section would otherwise take the canvas's row. */}
      <Toaster theme={resolvedMode} richColors closeButton />
      <FineMode />
    </>
  );
}

const NO_PROJECTS: ProjectSummary[] = [];
const NO_PROVIDERS: ModelProvider[] = [];

const readProjects = singleFlight(async () => ({
  projects: await listProjects("all"),
}));

/** What the home fold rests on; `refresh` re-reads all of it at once. */
const FOLD_READS = [keys.modelCatalog, keys.projects, keys.workspaces] as const;
