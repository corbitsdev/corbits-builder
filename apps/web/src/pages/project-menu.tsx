/**
 * A project's options menu, the same wherever a project is named: the
 * rail row and the title in the top bar. Info (and rename),
 * export, the shipped mark, archive, and a two-step delete, matching the
 * project operations the hub offers. The dialogs it opens live here too,
 * so the menu is complete on its own.
 */
import { wording } from "../config.ts";
import { Checkbox, Input } from "@corbits/react-ui";
import {
  EXPORT_SECTIONS,
  type ExportSection,
} from "@corbits-builder/schemas/project";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { useEffect, useState, type ReactElement } from "react";
import { api } from "../client.js";
import { Banner, Button, type NoticeAction } from "../components.jsx";
import { Dictated } from "../dictation.jsx";

/** What the menu needs of a project: the summaries (rail, top bar) both have it. */
export type MenuProject = {
  id: string;
  title: string;
  archivedAt: string | null;
  shippedAt: string | null;
  createdAt?: string;
};

/**
 * Saves the project zip of the given sections, named after the project, and returns the note on
 * which app version its build carries, when it has one.
 */
async function exportProject(
  project: MenuProject,
  sections: readonly ExportSection[],
) {
  const { filename, archive, note } = await api.exportProject(
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

export function ProjectMenu({
  project,
  trigger,
  align = "end",
  onChanged,
  onError,
  onNotice,
  onDeleted,
}: {
  project: MenuProject;
  /** The element that opens the menu: the rail row's ellipsis, the top bar's title. */
  trigger: ReactElement;
  align?: "start" | "end";
  onChanged: () => void;
  onError: (cause: unknown) => void;
  onNotice?: (
    message: string,
    complete?: boolean,
    action?: NoticeAction,
  ) => void;
  /** The project is gone; a host showing it should leave. */
  onDeleted?: () => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  // Rename opens the same dialog with the name field focused.
  const [focusName, setFocusName] = useState(false);
  // Deleting takes two clicks, both in the menu: the second item only exists
  // after the first, so a slip cannot remove a project.
  const [confirming, setConfirming] = useState(false);
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

  const openInfo = (withName = false) => {
    setFocusName(withName);
    setInfoOpen(true);
  };

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <MenuTrigger asChild>{trigger}</MenuTrigger>
        <MenuContent align={align}>
          <MenuItem onSelect={() => openInfo()}>Project info…</MenuItem>
          <MenuItem onSelect={() => openInfo(true)}>Rename</MenuItem>
          <MenuItem onSelect={() => setExporting(true)}>Export</MenuItem>
          {/* An archived project refuses every change until it is unarchived. */}
          {project.archivedAt ? null : (
            <MenuItem
              onSelect={() =>
                void act(() =>
                  api.updateProject(project.id, {
                    shipped: !project.shippedAt,
                  }),
                )
              }
            >
              {project.shippedAt
                ? wording.action.reopen
                : wording.action.markShipped}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem
            onSelect={() =>
              void act(() =>
                api.updateProject(project.id, {
                  archived: !project.archivedAt,
                }),
              )
            }
          >
            {project.archivedAt
              ? wording.action.unarchive
              : wording.action.archive}
          </MenuItem>
          <MenuSeparator />
          {confirming ? (
            <MenuItem
              className="menu-danger"
              onSelect={() =>
                void act(async () => {
                  await api.deleteProject(project.id);
                  onDeleted?.();
                })
              }
            >
              Yes, delete it
            </MenuItem>
          ) : (
            <MenuItem
              className="menu-danger"
              onSelect={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              Delete…
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      {infoOpen ? (
        // Portaled, but React-nested in the host: its events bubble to a
        // card face's handlers unless stopped here, the same as the menu's.
        <div
          className="card-dialog"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ProjectInfoDialog
            project={project}
            focusName={focusName}
            onClose={() => setInfoOpen(false)}
            onChanged={onChanged}
            onError={onError}
          />
        </div>
      ) : null}
      {exporting ? (
        <div
          className="card-dialog"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ExportDialog
            projectId={project.id}
            onClose={() => setExporting(false)}
            onExport={(sections) =>
              void act(async () => {
                const note = await exportProject(project, sections);
                if (note !== undefined) onNotice?.(note, true);
              }).then(() => setExporting(false))
            }
          />
        </div>
      ) : null}
    </>
  );
}

/** Offers the sections the project has; a failed check offers the planning documents and says why. */
function ExportDialog({
  projectId,
  onClose,
  onExport,
}: {
  projectId: string;
  onClose: () => void;
  onExport: (sections: ExportSection[]) => void;
}) {
  const [available, setAvailable] = useState<Set<ExportSection> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<ExportSection>>(() => new Set());
  useEffect(() => {
    let current = true;
    api.exportSections(projectId).then(
      (sections) => {
        if (!current) return;
        setAvailable(sections);
        setChosen(new Set(sections));
      },
      (cause: unknown) => {
        if (!current) return;
        const planning = new Set<ExportSection>(["planning"]);
        setFailure(
          wording.exportProject.sectionsFailed(
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
        setAvailable(planning);
        setChosen(new Set(planning));
      },
    );
    return () => {
      current = false;
    };
  }, [projectId]);
  const sections = EXPORT_SECTIONS.filter((section) => chosen.has(section));
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{wording.exportProject.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {available === null ? (
            <p role="status">{wording.exportProject.loading}</p>
          ) : null}
          {failure === null ? null : (
            <p className="inline-note" role="alert">
              {failure}
            </p>
          )}
          {EXPORT_SECTIONS.map((section) => (
            <Checkbox
              key={section}
              label={wording.exportProject.sections[section]}
              checked={chosen.has(section)}
              disabled={available === null || !available.has(section)}
              onCheckedChange={(checked) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (checked) next.add(section);
                  else next.delete(section);
                  return next;
                })
              }
            />
          ))}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{wording.action.cancel}</Button>
          <Button
            variant="primary"
            disabled={sections.length === 0}
            onClick={() => onExport(sections)}
          >
            {wording.exportProject.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectInfoDialog({
  project,
  focusName = false,
  onClose,
  onChanged,
  onError,
}: {
  project: MenuProject;
  /** Open with the name field focused (the menu's Rename). */
  focusName?: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (cause: unknown) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error] = useState<string | null>(null);

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
  const nextTitle = title.trim();
  const dirty = nextTitle.length > 0 && nextTitle !== project.title;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await act(() =>
      api.updateProject(project.id, { title: nextTitle }),
    );
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="project-info">
        <DialogHeader>
          <DialogTitle>{project.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {error ? <Banner tone="error" title={error} /> : null}
          <div className="field">
            <label htmlFor={`project-name-${project.id}`}>Name</label>
            <Dictated value={title} onValueChange={setTitle} align="center">
              <Input
                id={`project-name-${project.id}`}
                autoFocus={focusName}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                  if (event.key === "Escape") setTitle(project.title);
                }}
                aria-label="Project name"
              />
            </Dictated>
          </div>
          <dl className="version-list project-info-facts">
            {project.createdAt !== undefined ? (
              <div>
                <dt>Created</dt>
                <dd>{new Date(project.createdAt).toLocaleString()}</dd>
              </div>
            ) : null}
            <div>
              <dt>State</dt>
              <dd>
                {project.archivedAt
                  ? wording.status.archived
                  : project.shippedAt
                    ? wording.status.shipped
                    : wording.status.active}
              </dd>
            </div>
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button
            loading={archiving}
            disabled={saving}
            onClick={() => {
              setArchiving(true);
              void act(() =>
                api.updateProject(project.id, {
                  archived: !project.archivedAt,
                }),
              ).then((ok) => {
                setArchiving(false);
                if (ok) onClose();
              });
            }}
          >
            {project.archivedAt
              ? wording.action.unarchive
              : wording.action.archive}
          </Button>
          {/* Deleting is the menu's two-step affair, not part of editing a
              project's info. */}
          <Button
            variant="primary"
            loading={saving}
            disabled={!dirty || archiving}
            onClick={() => void save()}
          >
            {saving ? wording.action.saving : wording.action.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
