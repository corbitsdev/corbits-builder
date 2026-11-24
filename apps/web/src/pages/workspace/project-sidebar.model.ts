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
import { projectOutline } from "./project-outline.ts";
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
  const { projectId, shown } = input;
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
  return {
    sidebar: {
      project: input.title,
      open: frame.open,
      drawer: frame.drawer,
      plan: outline.plan,
      app: outline.app,
      appOpen: shown === LIVE_TAB,
      shown,
      waitsOn: input.waitsOn,
      onToggleSidebar: frame.toggle,
      onHome: input.onNewProject,
      onSettings: () => input.onOpenSettings(),
      onOpenApp: leaving(() => input.onOpen(LIVE_TAB)),
      onOpenStep: leaving(input.onOpen),
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
