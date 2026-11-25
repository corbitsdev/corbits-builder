/**
 * An open project's sidebar, as the room arranges it in the sidebar's card: the title row, the plan
 * under it, and below them, while the sidebar is open, the project's files and, at the foot, its
 * sections.
 */
import { useId } from "react";
import { wording } from "../../config.ts";
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
  /** The project's sections, at the foot under the files; absent, there are none. */
  sections?: SidebarSectionsProps | undefined;
};

export function ProjectSidebarView({
  project,
  menu,
  open,
  drawer,
  onToggleSidebar,
  onHome,
  onPreferences,
  plan,
  files,
  sections,
}: ProjectSidebarViewProps) {
  const bottomId = `project-sidebar-${useId()}`;
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
          onPreferences={onPreferences}
        />
      }
      top={<PlanTimeline {...plan} />}
      bottom={
        <>
          {files === undefined ? null : <FilesList {...files} />}
          {sections === undefined ? null : <SidebarSections {...sections} />}
        </>
      }
    />
  );
}
