/**
 * The project sidebar as the room fills it: the plan the room read, the files its project view can
 * open, and how the hub runs the app, run through the project's outline into the sidebar's props.
 * A step's settings go to the hub from here; a file or the app opens through the room.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PlanView } from "@corbits-builder/schemas/project";
import {
  declinePlanStep,
  restorePlanStep,
  setPlanStepAskFirst,
} from "../../api/artifacts.ts";
import { wording } from "../../config.ts";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";
import type { SettingsTab } from "../settings/settings.view.tsx";
import type {
  MenuProject,
  ProjectInfoDialogProps,
} from "../project-menu.model.ts";
import type { PaneDocument } from "./artifact-pane.tsx";
import { SIDEBAR_KEY, parseSidebarOpen } from "../../sidebar-setting.ts";
import { humanFault } from "./human-fault.ts";
import { liveAppQuery } from "./live-app.model.ts";
import { projectOutline } from "./project-outline.ts";
import type { ProjectSidebarViewProps } from "./project-sidebar.view.tsx";
import { LIVE_TAB } from "./tab-follow.ts";

/** Where the sidebar leads outside the room. */
export type SidebarWays = {
  onOpenSettings: (tab?: SettingsTab) => void;
  onNewProject: () => void;
};

export type ProjectSidebarInput = SidebarWays & {
  projectId: string;
  title: string;
  /** The project as its options menu reads it, for Project settings; absent until the list has it. */
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
  /** Opens the project view on a tab. */
  onOpen: (tab: string) => void;
  /** Reads the room again once the hub has a step's change. */
  reload: () => void;
};

/** The sidebar's props, all but whether it is a drawer, which only the room's width decides. */
export type ProjectSidebarProps = Omit<ProjectSidebarViewProps, "drawer">;

export function useProjectSidebar(input: ProjectSidebarInput): {
  sidebar: ProjectSidebarProps;
  /** Project settings, while open. */
  projectSettings: ProjectInfoDialogProps | null;
} {
  const { projectId, shown } = input;
  const open =
    useStoredPreference(SIDEBAR_KEY, parseSidebarOpen, "open") === "open";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const app = useQuery({ ...liveAppQuery(projectId), enabled: input.appShown });
  const outline = projectOutline({
    plan: input.plan,
    documents: input.documents,
    app: { shown: input.appShown, state: app.data?.state },
  });
  const change = async (send: () => Promise<unknown>) => {
    try {
      await send();
      input.reload();
    } catch (cause) {
      toast.error(humanFault(cause, wording.conversation.plan.notChanged));
    }
  };
  return {
    sidebar: {
      project: input.title,
      open,
      plan: outline.plan,
      app: outline.app,
      appOpen: shown === LIVE_TAB,
      shown,
      onToggleSidebar: () =>
        writeStoredPreference(SIDEBAR_KEY, open ? "closed" : "open"),
      onAskFirst: (stepId, askFirst) =>
        void change(() => setPlanStepAskFirst(projectId, stepId, askFirst)),
      onDecline: (stepId, declined) =>
        void change(() =>
          (declined ? declinePlanStep : restorePlanStep)(projectId, stepId),
        ),
      onOpenApp: () => input.onOpen(LIVE_TAB),
      onOpenStep: input.onOpen,
      onProjectSettings: () => setSettingsOpen(true),
      onNewProject: input.onNewProject,
      onWorkspaceSettings: () => input.onOpenSettings(),
      // The account is at the foot of Preferences.
      onAccount: () => input.onOpenSettings("preferences"),
    },
    projectSettings:
      settingsOpen && input.project !== undefined
        ? {
            project: input.project,
            onClose: () => setSettingsOpen(false),
            onChanged: input.onProjectChanged,
            onError: input.onProjectError,
          }
        : null,
  };
}
