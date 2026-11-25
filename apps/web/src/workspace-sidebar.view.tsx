/**
 * The sidebar outside a project, shown where a project was asked for and none opened; the new
 * project page, the Projects page and Settings have none. The sidebar's card and title row, holding
 * only what starts or resumes work. A new project, connecting a model while none is, and the
 * projects last worked on, to go straight back to one.
 */
import { Plus, Unplug } from "lucide-react";
import { SidebarItem } from "@corbits/react-ui";
import type { LucideIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { wording } from "./config.ts";
import { SidebarHeader } from "./pages/workspace/sidebar-header.tsx";
import { SidebarShell } from "./pages/workspace/sidebar-shell.tsx";
import styles from "./workspace-sidebar.module.css";

export type WorkspaceSidebarViewProps = {
  /** The open workspace's name, beside the mark. */
  name: string;
  /** Closed, only the name shows, to open it again. */
  open: boolean;
  /** The window is narrow, so the open sidebar lies over the page. */
  drawer: boolean;
  /** The page on screen, whose row is marked. */
  current: "newProject" | "library" | null;
  /** No model is connected yet, so the sidebar offers to connect one. */
  needsProvider: boolean;
  /** The projects last worked on, latest first; empty, the list is not shown. */
  recent: readonly { id: string; title: string }[];
  onToggleSidebar: () => void;
  onNewProject: () => void;
  onConnectModel: () => void;
  onOpenProject: (projectId: string) => void;
  /** Opens Settings on its Preferences tab, from the mark's menu. */
  onPreferences: () => void;
};

export function WorkspaceSidebarView({
  name,
  open,
  drawer,
  current,
  needsProvider,
  recent,
  onToggleSidebar,
  onNewProject,
  onConnectModel,
  onOpenProject,
  onPreferences,
}: WorkspaceSidebarViewProps) {
  const bottomId = `workspace-sidebar-${useId()}`;
  return (
    <SidebarShell
      label={wording.shell.sidebar}
      open={open}
      drawer={drawer}
      bottomId={bottomId}
      onPutAway={onToggleSidebar}
      header={
        <SidebarHeader
          title={name}
          open={open}
          controls={bottomId}
          onToggle={onToggleSidebar}
          onHome={onNewProject}
          onPreferences={onPreferences}
        />
      }
      bottom={
        <WorkspaceRows
          current={current}
          needsProvider={needsProvider}
          recent={recent}
          onNewProject={onNewProject}
          onConnectModel={onConnectModel}
          onOpenProject={onOpenProject}
        />
      }
    />
  );
}

/** What starts or resumes work: a new project, connecting a model, and the projects last worked on. */
function WorkspaceRows({
  current,
  needsProvider,
  recent,
  onNewProject,
  onConnectModel,
  onOpenProject,
}: Omit<
  WorkspaceSidebarViewProps,
  "name" | "open" | "drawer" | "onToggleSidebar" | "onPreferences"
>) {
  return (
    <>
      <ul className={styles.rows}>
        <Row
          icon={Plus}
          current={current === "newProject"}
          onClick={onNewProject}
        >
          {wording.shell.newProject}
        </Row>
        {needsProvider ? (
          <Row icon={Unplug} onClick={onConnectModel}>
            {wording.shell.connectModel}
          </Row>
        ) : null}
      </ul>
      {recent.length === 0 ? null : (
        <section className={styles.group} aria-label={wording.shell.recent}>
          <h2 className={styles.heading}>{wording.shell.recent}</h2>
          <ul className={styles.rows}>
            {recent.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className={styles.project}
                  title={project.title}
                  onClick={() => onOpenProject(project.id)}
                >
                  {project.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
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
