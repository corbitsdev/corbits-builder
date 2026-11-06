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
import styles from "./App.module.css";
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
  InlineNote,
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
import { Settings, type SettingsTab } from "./pages/settings/settings.jsx";
import {
  Avatar,
  Badge,
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
  Tabs,
  useTheme,
} from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { Auth } from "./pages/auth.jsx";
import { StageWorkspace } from "./pages/workspace/index.tsx";
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
  const copyDetail = async () => {
    try {
      await navigator.clipboard.writeText(detail);
    } catch (cause) {
      // Clipboard access can be denied, or missing outside a secure origin;
      // the text stays selectable in the disclosure.
      console.warn("Copying the failure detail failed.", cause);
      toast.error(wording.message.copyFailed);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.loadFailure}>
      <p className={styles.loadFailureTitle}>
        {wording.projectLoadFailure.title}
      </p>
      <p>{wording.projectLoadFailure.lead}</p>
      <div className={styles.loadFailureActions}>
        <Button variant="primary" onClick={onBackToProjects}>
          {wording.projectLoadFailure.back}
        </Button>
        <Button variant="secondary" onClick={onRetry}>
          {wording.action.tryAgain}
        </Button>
      </div>
      <details className={styles.loadFailureDetails}>
        <summary>{wording.projectLoadFailure.details}</summary>
        <pre>{detail}</pre>
        <Button variant="outline" onClick={() => void copyDetail()}>
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

export type WhatsNewTab = keyof typeof wording.whatsNew.tabs;

const WHATS_NEW_TABS: readonly { id: WhatsNewTab; label: string }[] = [
  { id: "slideDecks", label: wording.whatsNew.tabs.slideDecks },
  { id: "approvals", label: wording.whatsNew.tabs.approvals },
];

/**
 * Highlights new workspace features in a tabbed dialog and links directly to Settings → Preferences.
 */
export function WhatsNewDialog({
  open = true,
  initialTab = "slideDecks",
  onClose,
  onOpenPreferences,
}: {
  open?: boolean;
  initialTab?: WhatsNewTab;
  onClose: () => void;
  onOpenPreferences: (preferenceId?: string) => void;
}) {
  const copy = wording.whatsNew;
  const [activeTab, setActiveTab] = useState<WhatsNewTab>(initialTab);
  const renderFeatureTab = (tabId: WhatsNewTab) => {
    if (tabId === "approvals") {
      const feature = copy.features.approvals;
      return (
        <div className={styles.whatsNewPanel}>
          <p className={styles.whatsNewCopy}>{feature.description}</p>
          <div className={styles.whatsNewActions}>
            <InlineNote as="span">{feature.statusNote}</InlineNote>
            <UiButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenPreferences(feature.id)}
            >
              {feature.actionLabel}
            </UiButton>
          </div>
        </div>
      );
    }
    const feature = copy.features.slideDecks;
    return (
      <div className={styles.whatsNewPanel}>
        <p className={styles.whatsNewCopy}>{feature.description}</p>
      </div>
    );
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent aria-label={copy.title}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Tabs
            tabs={WHATS_NEW_TABS}
            active={activeTab}
            onChange={setActiveTab}
            label={copy.sections}
          >
            {renderFeatureTab}
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The rail down the left.
 *
 * A new project and the Projects page, then, under a rule, the projects still
 * in progress, most recent first, with the open one marked and its options
 * menu on it, above; Settings, which holds the account, below.
 * Collapsed, it is an icon rail that keeps every control and its name; the
 * choice is kept per browser.
 */
export function AppSidebar({
  view,
  project,
  projects,
  onOpenProject,
  onNavigate,
  onSettingsClose,
  onOpenWhatsNew,
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
  onOpenWhatsNew?: () => void;
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
    <Sidebar id="app-sidebar" className={styles.sidebar} collapsed={collapsed}>
      <SidebarHeader>
        <WorkspaceMenu onOpen={onOpenWorkspace} />
        <SidebarCollapseToggle
          collapsed={collapsed}
          onToggle={() => writeSidebar(collapsed ? "expanded" : "collapsed")}
        />
      </SidebarHeader>
      <SidebarContent>
        <ul className={styles.list}>
          <SidebarItem asChild active={view === "projects"} icon={<Plus />}>
            <button
              type="button"
              className={styles.newProject}
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
            className={styles.projects}
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
                      className={styles.initial}
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
                          className={styles.rowMenu}
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
        <ul className={styles.list}>
          <SidebarItem asChild>
            <button type="button" onClick={onOpenWhatsNew}>
              <span className={styles.whatsNewItem}>
                <span>{wording.shell.whatsNew}</span>
                <Badge tone="neutral">{wording.shell.whatsNewBadge}</Badge>
              </span>
            </button>
          </SidebarItem>
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
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(
    undefined,
  );
  const [focusPreference, setFocusPreference] = useState<string | undefined>(
    undefined,
  );
  const [focusSeq, setFocusSeq] = useState(0);
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
  const openPreferencesFromWhatsNew = (preferenceId?: string) => {
    setWhatsNewOpen(false);
    openSettings(
      "preferences",
      preferenceId ?? wording.whatsNew.features.approvals.id,
    );
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

  const projectView = () => {
    if (selected === null)
      return (
        <div className={styles.loadFailure}>
          <p className={styles.loadFailureTitle}>
            {wording.shell.noProjectTitle}
          </p>
          <p>{wording.shell.noProjectLead}</p>
        </div>
      );
    if (settledMissId === selected && openProjectSummary === null)
      return (
        <ProjectLoadFailure
          detail={wording.projectLoadFailure.notListed}
          onRetry={() => void refresh()}
          onBackToProjects={() => navigate("projects")}
        />
      );
    return (
      <StageWorkspace
        key={selected}
        projectId={selected}
        projectTitle={
          openProjectSummary?.title ?? wording.shell.untitledProject
        }
        {...(openProjectSummary === null
          ? {}
          : { listedArchived: openProjectSummary.archivedAt !== null })}
        onChanged={refresh}
        onOpenSettings={openSettings}
        {...(openingMessage !== undefined ? { openingMessage } : {})}
      />
    );
  };

  return (
    <>
      <div className={styles.app}>
        <AppSidebar
          view={view}
          project={openProjectSummary}
          projects={projects}
          onOpenProject={(projectId) => openProject(projectId)}
          onNavigate={navigate}
          onSettingsClose={closeSettings}
          onOpenWhatsNew={() => setWhatsNewOpen(true)}
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

        <main className={styles.canvas}>
          <div
            className={styles.canvasBody}
            data-fill={view === "project" ? "" : undefined}
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

            {view === "project" ? projectView() : null}

            {view === "settings" ? (
              <Settings
                onChanged={refresh}
                user={user}
                onUserChanged={setUser}
                onSignOut={signOut}
                {...(settingsTab !== undefined
                  ? { requestedTab: settingsTab }
                  : {})}
                {...(focusPreference !== undefined ? { focusPreference } : {})}
                focusSeq={focusSeq}
              />
            ) : null}
          </div>
        </main>
      </div>
      {whatsNewOpen ? (
        <WhatsNewDialog
          onClose={() => setWhatsNewOpen(false)}
          onOpenPreferences={openPreferencesFromWhatsNew}
        />
      ) : null}
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
