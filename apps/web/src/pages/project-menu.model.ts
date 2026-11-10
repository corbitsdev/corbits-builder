/**
 * What a project's options menu does, matching the project operations the
 * hub offers: rename, export, the shipped mark, archive, and delete.
 */
import { wording } from "../config.ts";
import {
  EXPORT_SECTIONS,
  type ExportSection,
} from "@corbits-builder/schemas/project";
import { useEffect, useState } from "react";
import {
  archiveProject,
  exportProject as exportProjectArchive,
  exportSections,
  renameProject,
  restoreProject,
  shipProject,
} from "../api/projects.ts";
import type { NoticeAction } from "../notice.ts";
import type {
  ExportDialogViewProps,
  ProjectInfoDialogViewProps,
  ProjectMenuViewProps,
} from "./project-menu.view.tsx";

/** What the menu needs of a project: the summaries (rail, top bar) both have it. */
export type MenuProject = {
  id: string;
  title: string;
  archivedAt: string | null;
  shippedAt: string | null;
  createdAt?: string;
};

/** What a host gives the menu to act with: the project, and where each outcome goes. */
export type ProjectMenuHost = {
  project: MenuProject;
  onChanged: () => void;
  onError: (cause: unknown) => void;
  onNotice?: (
    message: string,
    complete?: boolean,
    action?: NoticeAction,
  ) => void;
  /** The project is gone; a host showing it should leave. */
  onDeleted?: () => void;
};

export type ProjectInfoDialogProps = {
  project: MenuProject;
  /** Open with the name field focused (the menu's Rename). */
  focusName?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (cause: unknown) => void;
};

export type ExportDialogProps = {
  projectId: string;
  onClose: () => void;
  onExport: (sections: ExportSection[]) => void;
};

/**
 * Saves the project zip of the given sections, named after the project, and returns the note on
 * which app version its build carries, when it has one.
 */
async function exportProject(
  project: MenuProject,
  sections: readonly ExportSection[],
) {
  const { filename, archive, note } = await exportProjectArchive(
    project.id,
    sections,
  );
  const href = URL.createObjectURL(archive);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
  return note;
}

export function useProjectMenu({
  project,
  onChanged,
  onError,
  onNotice,
  onDeleted,
}: ProjectMenuHost): {
  view: Omit<
    ProjectMenuViewProps,
    "trigger" | "align" | "infoDialog" | "exportDialog"
  >;
  /** What the project info dialog needs while it is open. */
  infoDialog: ProjectInfoDialogProps | null;
  /** What the export dialog needs while it is open. */
  exportDialog: ExportDialogProps | null;
} {
  const [infoOpen, setInfoOpen] = useState(false);
  // Rename opens the same dialog with the name field focused.
  const [focusName, setFocusName] = useState(false);
  // Export asks which parts to put in the zip.
  const [exporting, setExporting] = useState(false);

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      onChanged();
    } catch (cause) {
      onError(cause);
    }
  };

  const runExport = async (sections: ExportSection[]) => {
    try {
      await act(async () => {
        const note = await exportProject(project, sections);
        if (note !== undefined) onNotice?.(note, true);
      });
    } finally {
      setExporting(false);
    }
  };

  const openInfo = (withName = false) => {
    setFocusName(withName);
    setInfoOpen(true);
  };

  return {
    view: {
      archived: Boolean(project.archivedAt),
      shipped: Boolean(project.shippedAt),
      onShowInfo: () => openInfo(),
      onRename: () => openInfo(true),
      onExport: () => setExporting(true),
      onToggleShipped: () =>
        void act(() => shipProject(project.id, !project.shippedAt)),
      onToggleArchived: () =>
        void act(() =>
          project.archivedAt
            ? restoreProject(project.id)
            : archiveProject(project.id),
        ),
      onDelete: () =>
        void act(async () => {
          await archiveProject(project.id);
          onDeleted?.();
        }),
    },
    infoDialog: infoOpen
      ? {
          project,
          focusName,
          onClose: () => setInfoOpen(false),
          onChanged,
          onError,
        }
      : null,
    exportDialog: exporting
      ? {
          projectId: project.id,
          onClose: () => setExporting(false),
          onExport: (sections) => void runExport(sections),
        }
      : null,
  };
}

/** Reads which sections the project has; a failed check leaves the planning documents and says why. */
export function useExportDialog({
  projectId,
  onClose,
  onExport,
}: ExportDialogProps): ExportDialogViewProps {
  const [available, setAvailable] = useState<Set<ExportSection> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<ExportSection>>(() => new Set());
  useEffect(() => {
    let current = true;
    async function loadSections() {
      try {
        const sections = await exportSections(projectId);
        if (!current) return;
        setAvailable(sections);
        setChosen(new Set(sections));
      } catch (cause) {
        if (!current) return;
        const planning = new Set<ExportSection>(["planning"]);
        setFailure(
          wording.exportProject.sectionsFailed(
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
        setAvailable(planning);
        setChosen(new Set(planning));
      }
    }
    void loadSections();
    return () => {
      current = false;
    };
  }, [projectId]);
  return {
    loading: available === null,
    failure,
    sections: EXPORT_SECTIONS.map((section) => ({
      section,
      available: available !== null && available.has(section),
      chosen: chosen.has(section),
    })),
    onChoose: (section, checked) =>
      setChosen((current) => {
        const next = new Set(current);
        if (checked) next.add(section);
        else next.delete(section);
        return next;
      }),
    onExport: () =>
      onExport(EXPORT_SECTIONS.filter((section) => chosen.has(section))),
    onClose,
  };
}

function stateOf(project: MenuProject): ProjectInfoDialogViewProps["state"] {
  if (project.archivedAt) return "archived";
  if (project.shippedAt) return "shipped";
  return "active";
}

export function useProjectInfoDialog({
  project,
  focusName = false,
  onClose,
  onChanged,
  onError,
}: ProjectInfoDialogProps): ProjectInfoDialogViewProps {
  const [name, setName] = useState(project.title);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      onChanged();
      return true;
    } catch (cause) {
      onError(cause);
      return false;
    }
  };

  // Edits are explicit: nothing is written until Save, which then closes
  // the dialog. Save is offered only once there is a change to keep.
  const nextTitle = name.trim();
  const dirty = nextTitle.length > 0 && nextTitle !== project.title;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await act(() => renameProject(project.id, nextTitle));
    setSaving(false);
    if (ok) onClose();
  };
  const toggleArchived = async () => {
    setArchiving(true);
    const ok = await act(() =>
      project.archivedAt
        ? restoreProject(project.id)
        : archiveProject(project.id),
    );
    setArchiving(false);
    if (ok) onClose();
  };

  return {
    title: project.title,
    name,
    onNameChange: setName,
    focusName,
    created:
      project.createdAt === undefined
        ? null
        : new Date(project.createdAt).toLocaleString(),
    state: stateOf(project),
    canSave: dirty,
    saving,
    archiving,
    onSave: () => void save(),
    onToggleArchived: () => void toggleArchived(),
    onClose,
  };
}
