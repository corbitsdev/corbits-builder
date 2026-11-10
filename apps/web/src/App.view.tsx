/**
 * The app shell as it looks: the rail on the left, and beside it the canvas
 * with its notices and the page on screen. The rail carries navigation only:
 * what the project is doing shows in the workspace. The parts that read the
 * hub (the workspace menu, each project's options and the page) arrive as
 * slots, so any state of the shell can be drawn without one.
 */
import { useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ellipsis,
  LayoutGrid,
  Plus,
  Settings as SettingsIcon,
} from "lucide-react";
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
} from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import { wording } from "./config.ts";
import styles from "./App.module.css";
import { Banner, Button, InlineNote, Mark } from "./components.jsx";

/** A project in progress, as its row in the rail. */
export type RailProject = {
  id: string;
  title: string;
  /** The project on screen; its row is marked. */
  open: boolean;
};

/** How the hub is answering; slow carries its recent average time per request. */
export type HubHealth =
  | { state: "answering" }
  | { state: "notAnswering" }
  | { state: "slow"; averageMs: number };

export type AppViewProps = {
  /**
   * The place on screen: its rail entry is marked, and an open project fills
   * the canvas. Null when the address names none of them.
   */
  current: "newProject" | "library" | "project" | "settings" | null;
  rail: {
    /** An icon rail that keeps every control and its name. */
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onNewProject: () => void;
    onLibrary: () => void;
    /** Leaves Settings for where it was opened from; offered while Settings is on screen. */
    onBack: () => void;
    /** The gear: opens Settings, and leaves it when it is already on screen. */
    onSettings: () => void;
    /** The projects still in progress, most recent first. */
    projects: readonly RailProject[];
    onOpenProject: (projectId: string) => void;
  };
  /** The rail's top: the open workspace and the person's others. */
  workspaceMenu: ReactNode;
  /** A rail project's options menu, opened by the trigger the rail draws for it. */
  projectMenu: (projectId: string, trigger: ReactElement) => ReactNode;
  hub: HubHealth;
  /** Why setting up the workspace did not finish. */
  setupFault: string | null;
  /** The page on screen. */
  page: ReactNode;
  /** The person followed What's new to a preference in Settings. */
  onOpenPreferences: (preferenceId?: string) => void;
};

export function AppView({
  current,
  rail,
  workspaceMenu,
  projectMenu,
  hub,
  setupFault,
  page,
  onOpenPreferences,
}: AppViewProps) {
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  return (
    <>
      <div className={styles.app}>
        <Rail
          current={current}
          rail={rail}
          workspaceMenu={workspaceMenu}
          projectMenu={projectMenu}
          onOpenWhatsNew={() => setWhatsNewOpen(true)}
        />

        <main className={styles.canvas}>
          <div
            className={styles.canvasBody}
            data-fill={current === "project" ? "" : undefined}
          >
            <HubNotice hub={hub} />

            {setupFault ? (
              <Banner tone="error" title={wording.workspace.setupIncomplete}>
                {setupFault}
              </Banner>
            ) : null}

            {page}
          </div>
        </main>
      </div>
      {whatsNewOpen ? (
        <WhatsNewDialog
          onClose={() => setWhatsNewOpen(false)}
          onOpenPreferences={(preferenceId) => {
            setWhatsNewOpen(false);
            onOpenPreferences(preferenceId);
          }}
        />
      ) : null}
    </>
  );
}

function HubNotice({ hub }: { hub: HubHealth }) {
  if (hub.state === "notAnswering")
    return <Banner tone="error" title={wording.hub.notAnswering} />;
  if (hub.state === "slow")
    return (
      // Said rather than left to be wondered about: every request on this
      // page waits on the hub, and the hub's own log names which requests
      // are slow.
      <Banner tone="warning" title={wording.hub.slowTitle(hub.averageMs)}>
        {wording.hub.slowLead}
      </Banner>
    );
  return null;
}

// The library's collapsed-rail label class: a project row's name hides
// in the icon rail exactly as a SidebarItem's does.
const RAIL_LABEL_CLASS = "group-data-[collapsed=true]/sidebar:sr-only";

/**
 * The rail down the left.
 *
 * A new project and the Projects page, then, under a rule, the projects still
 * in progress, with the open one marked and its options menu on it, above;
 * Settings, which holds the account, below.
 * Collapsed, it is an icon rail that keeps every control and its name.
 */
function Rail({
  current,
  rail: {
    collapsed,
    onToggleCollapsed,
    onNewProject,
    onLibrary,
    onBack,
    onSettings,
    projects,
    onOpenProject,
  },
  workspaceMenu,
  projectMenu,
  onOpenWhatsNew,
}: Pick<AppViewProps, "current" | "rail" | "workspaceMenu" | "projectMenu"> & {
  onOpenWhatsNew: () => void;
}) {
  const inSettings = current === "settings";
  return (
    <Sidebar id="app-sidebar" className={styles.sidebar} collapsed={collapsed}>
      <SidebarHeader>
        {workspaceMenu}
        <SidebarCollapseToggle
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
        />
      </SidebarHeader>
      <SidebarContent>
        <ul className={styles.list}>
          <SidebarItem
            asChild
            active={current === "newProject"}
            icon={<Plus />}
          >
            <button
              type="button"
              className={styles.newProject}
              onClick={onNewProject}
            >
              {wording.shell.newProject}
            </button>
          </SidebarItem>
          <SidebarItem
            asChild
            active={current === "library"}
            icon={<LayoutGrid />}
          >
            <button type="button" onClick={onLibrary}>
              {wording.shell.projects}
            </button>
          </SidebarItem>
          {inSettings ? (
            <SidebarItem asChild icon={<ArrowLeft />}>
              <button type="button" onClick={onBack}>
                {wording.shell.back}
              </button>
            </SidebarItem>
          ) : null}
        </ul>
        {projects.length > 0 ? (
          <SidebarSection
            label={wording.shell.inProgress}
            className={styles.projects}
          >
            {projects.map((item) => (
              <SidebarItemRow
                key={item.id}
                selected={item.open}
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
                action={projectMenu(
                  item.id,
                  <UiButton
                    variant="ghost"
                    size="icon"
                    className={styles.rowMenu}
                    aria-label={wording.shell.projectOptions(item.title)}
                  >
                    <Ellipsis aria-hidden="true" />
                  </UiButton>,
                )}
              />
            ))}
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
              onClick={onSettings}
            >
              {wording.shell.settings}
            </button>
          </SidebarItem>
        </ul>
      </SidebarFooter>
    </Sidebar>
  );
}

export type BootViewProps = {
  /** How the wait is going: just begun, taking long, or held up by a hub that is not answering. */
  wait: "starting" | "slow" | "offline";
};

const BOOT_MESSAGES = {
  starting: wording.boot.starting,
  slow: wording.boot.slow,
  offline: wording.loading,
};

/**
 * The first moments, before the hub has said anything.
 *
 * Deliberately not a spinner over a half-built layout: there is no layout yet,
 * because which one is right is exactly what is unknown. One line, and after a
 * while an admission that it is taking longer than it should.
 */
export function BootView({ wait }: BootViewProps) {
  return (
    <BootScreen
      message={BOOT_MESSAGES[wait]}
      brand={<Mark size={26} />}
      footer={
        <a href={wording.builtBy.href} target="_blank" rel="noreferrer">
          {wording.builtBy.label}
        </a>
      }
    />
  );
}

/** In the page's place when a project is asked for and none is open. */
export function NoProjectOpen() {
  return (
    <div className={styles.loadFailure}>
      <p className={styles.loadFailureTitle}>{wording.shell.noProjectTitle}</p>
      <p>{wording.shell.noProjectLead}</p>
    </div>
  );
}

export type ProjectLoadFailureProps = {
  /** The raw cause, kept behind a disclosure. */
  detail: string;
  onRetry: () => void;
  onBackToProjects: () => void;
};

/**
 * A failed project conversation load: plain language and a way out first, the
 * raw cause behind a disclosure rather than in a red box.
 */
export function ProjectLoadFailure({
  detail,
  onRetry,
  onBackToProjects,
}: ProjectLoadFailureProps) {
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
