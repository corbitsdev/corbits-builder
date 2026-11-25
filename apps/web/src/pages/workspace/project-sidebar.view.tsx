/**
 * An open project's sidebar, as the room arranges it in the sidebar's card: the title row, the plan
 * under it, and below them, while the sidebar is open, the project's files and, at the foot, its
 * sections, or the app's own line until the room passes the sections.
 */
import { useId } from "react";
import { wording } from "../../config.ts";
import { AppLine, type AppLineProps } from "./app-line.tsx";
import { FilesList, type FilesListProps } from "./files-list.tsx";
import { PlanTimeline, type PlanTimelineProps } from "./plan-timeline.tsx";
import {
  SidebarHeader,
  type MarkWays,
  type TitleMenu,
} from "./sidebar-header.tsx";
import {
  SidebarSections,
  type SidebarSectionsProps,
} from "./sidebar-sections.tsx";
import { SidebarShell } from "./sidebar-shell.tsx";

export type ProjectSidebarViewProps = MarkWays & {
  project: string;
  /** The project's own menu, opened from its name; absent, the name is only shown. */
  menu?: TitleMenu | undefined;
  /** Closed, the card holds the name and the plan alone. */
  open: boolean;
  /** The window is too narrow for the sidebar beside the page, so the open sidebar lies over it. */
  drawer: boolean;
  onToggleSidebar: () => void;
  plan: PlanTimelineProps;
  /** The project's files; absent, there is no Files group. */
  files?: FilesListProps | undefined;
  /** The project's sections, at the foot under the files; absent, the app has its own line. */
  sections?: SidebarSectionsProps | undefined;
  /** The app's own line, where no step of the plan makes it; null where one does. */
  appLine: AppLineProps | null;
};

export function ProjectSidebarView({
  project,
  menu,
  open,
  drawer,
  onToggleSidebar,
  onHome,
  onSettings,
  plan,
  files,
  sections,
  appLine,
}: ProjectSidebarViewProps) {
  const bottomId = `project-sidebar-${useId()}`;
  const line = appLine === null ? null : <AppLine {...appLine} />;
  const foot =
    sections === undefined ? line : <SidebarSections {...sections} />;
  return (
    <SidebarShell
      label={wording.projectShell.sidebar}
      open={open}
      drawer={drawer}
      bottomId={bottomId}
      onPutAway={onToggleSidebar}
      header={
        <SidebarHeader
          title={project}
          titleMenu={menu}
          open={open}
          controls={bottomId}
          onToggle={onToggleSidebar}
          onHome={onHome}
          onSettings={onSettings}
        />
      }
      top={<PlanTimeline {...plan} />}
      bottom={
        <>
          {files === undefined ? null : <FilesList {...files} />}
          {foot}
        </>
      }
    />
  );
}
