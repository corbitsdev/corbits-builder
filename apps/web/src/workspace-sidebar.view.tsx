/**
 * The sidebar outside a project, on the new project page, the projects and Settings: the project
 * sidebar's frame and foot, holding only what starts work. A new project, then while the person is
 * new to Builder the first steps: connecting a model while none is, and what's new.
 */
import {
  Building2,
  CircleUser,
  Folder,
  Plus,
  Sparkles,
  Unplug,
} from "lucide-react";
import { Badge, SidebarItem } from "@corbits/react-ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { wording } from "./config.ts";
import {
  SidebarFoot,
  SidebarFrame,
  SidebarLink,
  SidebarLinks,
} from "./pages/workspace/project-sidebar.view.tsx";
import styles from "./workspace-sidebar.module.css";

const words = wording.projectShell;

export type WorkspaceSidebarViewProps = {
  /** The open workspace's name, beside the mark. */
  name: string;
  /** Closed, only the name shows, to open it again. */
  open: boolean;
  /** The window is narrow, so the open sidebar lies over the page. */
  drawer: boolean;
  /** The page on screen, whose row is marked. */
  current: "newProject" | "library" | "settings" | null;
  /** No model is connected yet, so the first steps offer to connect one. */
  needsProvider: boolean;
  onToggleSidebar: () => void;
  onNewProject: () => void;
  onConnectModel: () => void;
  onWhatsNew: () => void;
  onAllProjects: () => void;
  onWorkspaceSettings: () => void;
  onAccount: () => void;
};

export function WorkspaceSidebarView({
  name,
  open,
  drawer,
  current,
  needsProvider,
  onToggleSidebar,
  onNewProject,
  onConnectModel,
  onWhatsNew,
  onAllProjects,
  onWorkspaceSettings,
  onAccount,
}: WorkspaceSidebarViewProps) {
  return (
    <SidebarFrame
      label={wording.shell.sidebar}
      title={name}
      open={open}
      drawer={drawer}
      onToggleSidebar={onToggleSidebar}
    >
      <ul className={styles.rows}>
        <Row
          icon={Plus}
          current={current === "newProject"}
          onClick={onNewProject}
        >
          {wording.shell.newProject}
        </Row>
      </ul>
      <section className={styles.group} aria-label={wording.shell.getStarted}>
        <h2 className={styles.heading}>{wording.shell.getStarted}</h2>
        <ul className={styles.rows}>
          {needsProvider ? (
            <Row icon={Unplug} onClick={onConnectModel}>
              {wording.shell.connectModel}
            </Row>
          ) : null}
          <Row icon={Sparkles} onClick={onWhatsNew}>
            <span className={styles.label}>
              {wording.shell.whatsNew}
              <Badge tone="neutral">{wording.shell.whatsNewBadge}</Badge>
            </span>
          </Row>
        </ul>
      </section>
      <SidebarFoot>
        <SidebarLinks label={words.groups.projects}>
          <SidebarLink
            icon={Folder}
            current={current === "library"}
            onClick={onAllProjects}
          >
            {words.allProjects}
          </SidebarLink>
        </SidebarLinks>
        <SidebarLinks label={words.groups.workspace}>
          <SidebarLink
            icon={Building2}
            current={current === "settings"}
            onClick={onWorkspaceSettings}
          >
            {words.workspaceSettings}
          </SidebarLink>
          <SidebarLink icon={CircleUser} onClick={onAccount}>
            {words.account}
          </SidebarLink>
        </SidebarLinks>
      </SidebarFoot>
    </SidebarFrame>
  );
}

/** One of the sidebar's own rows, at the size of the plan's; marked while its page is on screen. */
function Row({
  icon: Icon,
  current = false,
  onClick,
  children,
}: {
  icon: LucideIcon;
  current?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SidebarItem
      asChild
      className={styles.row}
      icon={<Icon aria-hidden="true" />}
    >
      <button
        type="button"
        aria-current={current ? "page" : undefined}
        onClick={onClick}
      >
        {children}
      </button>
    </SidebarItem>
  );
}
