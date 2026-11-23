/**
 * The app shell as it looks: outside a project the workspace sidebar on the
 * left, and beside it the canvas with its notices and the page on screen. A
 * project's room draws its own sidebar. The page, which reads the hub, arrives
 * as a slot, so any state of the shell can be drawn without one.
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BootScreen } from "@corbits/react-ui";
import { wording } from "./config.ts";
import styles from "./App.module.css";
import { Banner, Button, Mark } from "./components.jsx";
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
  /** The sidebar outside a project, all but its marked row, which the shell keeps. */
  sidebar: Omit<WorkspaceSidebarViewProps, "current">;
  hub: HubHealth;
  /** Why setting up the workspace did not finish. */
  setupFault: string | null;
  /** The page on screen. */
  page: ReactNode;
};

export function AppView({
  current,
  roomOpen,
  sidebar,
  hub,
  setupFault,
  page,
}: AppViewProps) {
  return (
    <div className={styles.app} data-room={roomOpen ? "" : undefined}>
      {roomOpen ? null : (
        <WorkspaceSidebarView
          {...sidebar}
          current={current === "project" ? null : current}
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
