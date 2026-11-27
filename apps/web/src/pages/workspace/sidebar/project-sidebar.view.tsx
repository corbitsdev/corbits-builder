/**
 * An open project's sidebar, as the room arranges it in the sidebar's cards: the title, the plan
 * under it, and below them, while the sidebar is expanded, the project's files and its sections.
 */
import { wording } from "../../../config.ts";
import { FilesList, type FilesListProps } from "./files-list.tsx";
import { PlanTimeline, type PlanTimelineProps } from "./plan-timeline.tsx";
import {
  SidebarHeader,
  type MarkWays,
  type TitleMenu,
} from "../../../sidebar-header.tsx";
import {
  SidebarSections,
  type SidebarSectionsProps,
} from "./sidebar-sections.tsx";
import { SidebarShell, SidebarSurface } from "../../../sidebar-shell.tsx";

export type ProjectSidebarViewProps = MarkWays & {
  project: string;
  /** The project's own menu, opened from its name; absent, the name is only shown. */
  menu?: TitleMenu | undefined;
  /** Collapsed, the sidebar holds the name and the plan alone. */
  open: boolean;
  /** The window is too narrow for the sidebar beside the page, so the open sidebar lies over it. */
  drawer: boolean;
  onToggleSidebar: () => void;
  plan: PlanTimelineProps;
  /** The project's files; absent, there is no Files group. */
  files?: FilesListProps | undefined;
  /** The project's sections, each a card of its own under the files; absent, there are none. */
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
  return (
    <SidebarShell
      label={wording.projectShell.sidebar}
      open={open}
      drawer={drawer}
      onToggle={onToggleSidebar}
      header={
        <SidebarHeader
          title={project}
          titleMenu={menu}
          onHome={onHome}
          onPreferences={onPreferences}
        />
      }
      surfaces={
        plan.plan.length === 0 ? null : (
          <SidebarSurface scrolls>
            <PlanTimeline {...plan} />
          </SidebarSurface>
        )
      }
      more={
        <>
          {files === undefined || files.files.length === 0 ? null : (
            <SidebarSurface scrolls>
              <FilesList {...files} />
            </SidebarSurface>
          )}
          {sections === undefined ? null : <SidebarSections {...sections} />}
        </>
      }
    />
  );
}
