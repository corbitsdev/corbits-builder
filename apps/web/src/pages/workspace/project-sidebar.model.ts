/**
 * The project sidebar as the room fills it: the plan the room read, the files its project view can
 * open, and how the hub runs the app, run through the project's outline into the sidebar's props.
 * A file or the app opens through the room.
 */
import { useQuery } from "@tanstack/react-query";
import type { PlanView } from "@corbits-builder/schemas/project";
import type { MenuProject, ProjectMenuHost } from "../project-menu.model.ts";
import type { PaneDocument } from "./artifact-pane.tsx";
import { ROOM_NARROW_QUERY, useSidebar } from "../../sidebar-setting.ts";
import { liveAppQuery } from "./live-app.model.ts";
import type { AppLineProps } from "./app-line.tsx";
import type { PlanTimelineProps } from "./plan-timeline.tsx";
import { projectOutline, type Outline } from "./project-outline.ts";
import type { ProjectSidebarViewProps } from "./project-sidebar.view.tsx";
import { LIVE_TAB } from "./tab-follow.ts";

/** Where the sidebar leads outside the room. */
export type SidebarWays = {
  onOpenSettings: () => void;
  onNewProject: () => void;
};

export type ProjectSidebarInput = SidebarWays & {
  projectId: string;
  title: string;
  /** The project as its menu reads it; absent until the project list has it. */
  project: MenuProject | undefined;
  onProjectChanged: () => void;
  onProjectError: (cause: unknown) => void;
  plan: PlanView["steps"];
  /** The filed documents the project view shows. */
  documents: readonly PaneDocument[];
  /** The project view can show an app, built or being built. */
  appShown: boolean;
  /** The tab on the page; null while the chat fills the room. */
  shown: string | null;
  /** The document opened from what waits in the prompt box, while it still waits; else null. */
  waitsOn: string | null;
  /** Opens the project view on a tab. */
  onOpen: (tab: string) => void;
};

export function useProjectSidebar(input: ProjectSidebarInput): {
  sidebar: ProjectSidebarViewProps;
  /** The project's own menu, opened from its name; null until the project list has it. */
  projectMenu: ProjectMenuHost | null;
} {
  const { projectId } = input;
  const frame = useSidebar(ROOM_NARROW_QUERY);
  // Opening something from a drawer puts the drawer away, so the page is seen.
  const leaving =
    <T extends unknown[]>(go: (...args: T) => void) =>
    (...args: T) => {
      frame.leave();
      go(...args);
    };
  const app = useQuery({ ...liveAppQuery(projectId), enabled: input.appShown });
  const outline = projectOutline({
    plan: input.plan,
    documents: input.documents,
    app: { shown: input.appShown, state: app.data?.state },
  });
  const open = leaving(input.onOpen);
  return {
    sidebar: {
      project: input.title,
      open: frame.open,
      drawer: frame.drawer,
      onToggleSidebar: frame.toggle,
      onHome: input.onNewProject,
      onSettings: () => input.onOpenSettings(),
      plan: planProps(outline, input, open),
      appLine: appLineProps(outline, input.shown, open),
    },
    projectMenu:
      input.project === undefined
        ? null
        : {
            project: input.project,
            onChanged: input.onProjectChanged,
            onError: input.onProjectError,
            // Archived or deleted, the project is no longer one to work in, so the person goes home.
            onGone: input.onNewProject,
          },
  };
}

/** The plan as its timeline shows it, each step opening what it made. */
function planProps(
  outline: Outline,
  input: ProjectSidebarInput,
  open: (tab: string) => void,
): PlanTimelineProps {
  return {
    plan: outline.plan,
    app: outline.app,
    shown: input.shown,
    waitsOn: input.waitsOn,
    onOpenStep: open,
  };
}

/** The app's own line, which only stands where no step of the plan makes the app. */
function appLineProps(
  outline: Outline,
  shown: string | null,
  open: (tab: string) => void,
): AppLineProps | null {
  if (outline.plan.some((row) => row.app)) return null;
  return {
    app: outline.app,
    open: shown === LIVE_TAB,
    onOpen: () => open(LIVE_TAB),
  };
}
