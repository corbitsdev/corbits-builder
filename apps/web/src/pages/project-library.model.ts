/**
 * Projects: every project the person can see, filtered by stage. The stage
 * is the hub's, from native state; archived projects show only under their
 * own filter, where they can be restored.
 */
import { formatRelativeTime } from "@corbits/react-ui";
import { useEffect, useRef, useState } from "react";
import { useLibraryView, writeLibraryView } from "../library-view-setting.ts";
import type { ProjectSummary } from "../api/types.ts";
import type { NoticeAction } from "../notice.ts";
import { useCoverPages } from "./project-cover.model.ts";
import type { ProjectMenuHost } from "./project-menu.model.ts";
import type {
  LibraryFilter,
  ProjectLibraryViewProps,
} from "./project-library.view.tsx";

export type ProjectLibraryProps = {
  projects: readonly ProjectSummary[];
  /** The list has been read at least once. */
  loaded: boolean;
  failed: boolean;
  onOpen: (projectId: string) => void;
  onNewProject: () => void;
  onChanged: () => void;
  onError: (cause: unknown) => void;
  onNotice: (
    message: string,
    complete?: boolean,
    action?: NoticeAction,
  ) => void;
};

function statusOf(
  loaded: boolean,
  failed: boolean,
): ProjectLibraryViewProps["status"] {
  if (loaded) return "ready";
  return failed ? "failed" : "loading";
}

export function useProjectLibrary({
  projects,
  loaded,
  failed,
  onOpen,
  onNewProject,
  onChanged,
  onError,
  onNotice,
}: ProjectLibraryProps): {
  view: Omit<ProjectLibraryViewProps, "menu">;
  /** What the options menu of a listed project needs. */
  menuOf: (projectId: string) => ProjectMenuHost;
} {
  const [filter, setFilter] = useState<LibraryFilter | null>(null);
  const layout = useLibraryView();
  const sorted = projects.toSorted((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
  const visible = sorted.filter((project) => !project.archivedAt);
  const matching = (of: LibraryFilter) =>
    of === "archived"
      ? sorted.filter((project) => project.archivedAt)
      : visible.filter((project) => project.stage === of);
  const shown = filter === null ? visible : matching(filter);
  // A list's small swatch shows the pattern only.
  const covers = useCoverPages(
    shown.map((project) => project.id),
    layout === "grid",
  );

  // A menu action can take its card out of the filter; once the list has been read again, the
  // page is told where the card was, so focus can move to the card now in its place.
  const changed = useRef<{
    id: string;
    index: number;
    before: typeof projects;
  } | null>(null);
  const [focusAfterChange, setFocusAfterChange] =
    useState<ProjectLibraryViewProps["focusAfterChange"]>(null);
  useEffect(() => {
    const pending = changed.current;
    if (pending === null || pending.before === projects) return;
    changed.current = null;
    if (shown.some((project) => project.id === pending.id)) return;
    setFocusAfterChange({ index: pending.index });
  }, [projects, shown]);

  return {
    view: {
      status: statusOf(loaded, failed),
      filter,
      onFilterChange: setFilter,
      counts: {
        idea: matching("idea").length,
        building: matching("building").length,
        shipped: matching("shipped").length,
        archived: matching("archived").length,
      },
      projects: shown.map((project, index) => ({
        id: project.id,
        title: project.title,
        stage: project.archivedAt ? "archived" : project.stage,
        lastActivityAt: project.lastActivityAt,
        lastActive: formatRelativeTime(project.lastActivityAt),
        mockup: covers.pages[index]!,
      })),
      layout,
      onLayoutChange: writeLibraryView,
      onOpen,
      onNewProject,
      onCoverNear: covers.onNear,
      focusAfterChange,
    },
    menuOf: (projectId) => {
      const index = shown.findIndex((project) => project.id === projectId);
      return {
        project: shown[index]!,
        onChanged: () => {
          changed.current = { id: projectId, index, before: projects };
          onChanged();
        },
        onError,
        onNotice,
      };
    },
  };
}
