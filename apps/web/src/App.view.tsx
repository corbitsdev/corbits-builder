/**
 * The app shell as it looks: outside a project the workspace sidebar on the
 * left, and beside it the canvas with its notices and the page on screen. A
 * project's room draws its own sidebar. The page, which reads the hub, arrives
 * as a slot, so any state of the shell can be drawn without one.
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BootScreen, Button as UiButton, Tabs } from "@corbits/react-ui";
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
import {
  WorkspaceSidebarView,
  type WorkspaceSidebarViewProps,
} from "./workspace-sidebar.view.tsx";

/** Whether the hub is answering. */
export type HubHealth = { state: "answering" | "notAnswering" };

export type AppViewProps = {
  /**
   * The place on screen: its sidebar row is marked, and an open project fills
   * the canvas. Null when the address names none of them.
   */
  current: "newProject" | "library" | "project" | "settings" | null;
  /** A project's room is on the page, and its own sidebar stands where the workspace's would. */
  roomOpen: boolean;
  /** The sidebar outside a project, all but its marked row and What's new, which the shell keeps. */
  sidebar: Omit<WorkspaceSidebarViewProps, "current" | "onWhatsNew">;
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
  roomOpen,
  sidebar,
  hub,
  setupFault,
  page,
  onOpenPreferences,
}: AppViewProps) {
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  return (
    <>
      <div className={styles.app} data-room={roomOpen ? "" : undefined}>
        {roomOpen ? null : (
          <WorkspaceSidebarView
            {...sidebar}
            current={current === "project" ? null : current}
            onWhatsNew={() => setWhatsNewOpen(true)}
          />
        )}

        <main className={styles.canvas}>
          <div
            className={styles.canvasBody}
            data-fill={current === "project" ? "" : undefined}
          >
            <HubNotice hub={hub} />

            {hub.state === "answering" && setupFault ? (
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
  return null;
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
