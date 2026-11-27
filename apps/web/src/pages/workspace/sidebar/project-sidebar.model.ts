/**
 * The project sidebar as the room fills it: the plan the room read, the files its project view can
 * open, and how the hub runs the app, run through the project's outline into the sidebar's props.
 * A file or the app opens through the room.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PlanView } from "@corbits-builder/schemas/plan";
import type { MenuProject, ProjectMenuHost } from "../../project-menu.model.ts";
import type { PaneDocument } from "../pane/pane-documents.ts";
import { wording, type SettingsTab } from "../../../config.ts";
import { ROOM_NARROW_QUERY, useSidebar } from "../../../sidebar-setting.ts";
import { liveAppQuery } from "../app/live-app.model.ts";
import type { FilesListProps } from "./files-list.tsx";
import {
  fileRows,
  projectOutline,
  type OutlineAppState,
} from "./project-outline.ts";
import type { ProjectSidebarViewProps } from "./project-sidebar.view.tsx";
import type { RoomSession } from "../room-session.ts";
import type { SidebarSectionsProps } from "./sidebar-sections.tsx";
import { LIVE_TAB, MANUAL_TAB } from "../tab-follow.ts";

const words = wording.projectShell;

/** Where the sidebar leads outside the room. */
export type SidebarWays = {
  onOpenSettings: (tab?: SettingsTab) => void;
  onNewProject: () => void;
};

export type ProjectSidebarInput = SidebarWays & {
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
  /** The hub has the app's user manual, so the project view can show it. */
  manualShown: boolean;
  /** The document opened from what waits in the prompt box, while it still waits; else null. */
  waitsOn: string | null;
};

export function useProjectSidebar(
  session: RoomSession,
  input: ProjectSidebarInput,
): {
  sidebar: ProjectSidebarViewProps;
  /** The project's own menu, opened from its name; null until the project list has it. */
  projectMenu: ProjectMenuHost | null;
} {
  const { projectId } = session;
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
  const open = leaving(session.openTab);
  // The step opened from the plan, apart from the file on the page, so neither marks the other.
  const [step, setStep] = useState<string | null>(null);
  return {
    sidebar: {
      project: input.title,
      open: frame.open,
      drawer: frame.drawer,
      onToggleSidebar: frame.toggle,
      onHome: input.onNewProject,
      onPreferences: () => input.onOpenSettings("preferences"),
      plan: {
        plan: outline.plan,
        selected: session.shown === null ? null : step,
        waitsOn: input.waitsOn,
        onOpenStep: (id, tab) => {
          setStep(id);
          open(tab);
        },
      },
      files: filesProps(input.documents, session.shown, open),
      sections: sectionsProps(
        outline.app,
        session.shown,
        input.manualShown,
        open,
      ),
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

/** The filed documents, each opening on its own tab. */
function filesProps(
  documents: ProjectSidebarInput["documents"],
  shown: string | null,
  open: (tab: string) => void,
): FilesListProps {
  return {
    files: fileRows(documents),
    shown,
    onOpen: open,
  };
}

/** The sections at the foot: the app's preview once there is an app, and its user manual. */
function sectionsProps(
  app: OutlineAppState,
  shown: string | null,
  manualShown: boolean,
  open: (tab: string) => void,
): SidebarSectionsProps | undefined {
  if (app === "not_built") return undefined;
  const preview = {
    id: LIVE_TAB,
    label: words.preview,
    selected: shown === LIVE_TAB,
  };
  const manual = {
    id: MANUAL_TAB,
    label: words.userManual,
    selected: shown === MANUAL_TAB,
  };
  return {
    sections: manualShown ? [preview, manual] : [preview],
    onOpen: open,
  };
}
