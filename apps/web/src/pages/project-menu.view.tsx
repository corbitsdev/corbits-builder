/**
 * A project's options menu as it looks, with the dialogs it opens: project
 * info (and rename) and export.
 */
import { wording } from "../config.ts";
import { Checkbox, Input } from "@corbits/react-ui";
import type { ExportSection } from "@corbits-builder/schemas/project";
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
import { useId, useState, type ReactElement, type ReactNode } from "react";
import { Button, DangerMenuItem, Fault, Field } from "../components.jsx";
import styles from "./project-menu.module.css";
import { Dictated } from "../dictation.jsx";

export type ProjectMenuViewProps = {
  /** The element that opens the menu: the rail row's ellipsis, the top bar's title. */
  trigger: ReactElement;
  align: "start" | "end";
  /** An archived project refuses every change until it is unarchived, so it offers only that. */
  archived: boolean;
  /** A shipped project offers to reopen rather than to mark it shipped. */
  shipped: boolean;
  onShowInfo: () => void;
  onRename: () => void;
  onExport: () => void;
  onToggleShipped: () => void;
  onToggleArchived: () => void;
  onDelete: () => void;
  /** The project info dialog while it is open, else null. */
  infoDialog: ReactNode;
  /** The export dialog while it is open, else null. */
  exportDialog: ReactNode;
};

export function ProjectMenuView({
  trigger,
  align,
  archived,
  shipped,
  onShowInfo,
  onRename,
  onExport,
  onToggleShipped,
  onToggleArchived,
  onDelete,
  infoDialog,
  exportDialog,
}: ProjectMenuViewProps) {
  // Deleting takes two clicks, both in the menu: the second item only exists
  // after the first, so a slip cannot remove a project.
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
      >
        <MenuTrigger asChild>{trigger}</MenuTrigger>
        <MenuContent align={align}>
          <MenuItem onSelect={onShowInfo}>Project info…</MenuItem>
          <MenuItem onSelect={onRename}>Rename</MenuItem>
          <MenuItem onSelect={onExport}>Export</MenuItem>
          {archived ? null : (
            <MenuItem onSelect={onToggleShipped}>
              {shipped ? wording.action.reopen : wording.action.markShipped}
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem onSelect={onToggleArchived}>
            {archived ? wording.action.unarchive : wording.action.archive}
          </MenuItem>
          <MenuSeparator />
          {confirming ? (
            <DangerMenuItem onSelect={onDelete}>Yes, delete it</DangerMenuItem>
          ) : (
            <DangerMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              Delete…
            </DangerMenuItem>
          )}
        </MenuContent>
      </Menu>
      {infoDialog === null ? null : (
        // Portaled, but React-nested in the host: its events bubble to a
        // card face's handlers unless stopped here, the same as the menu's.
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {infoDialog}
        </div>
      )}
      {exportDialog === null ? null : (
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {exportDialog}
        </div>
      )}
    </>
  );
}

export type ExportDialogViewProps = {
  /** The project is still being asked what it has to export; nothing can be ticked yet. */
  loading: boolean;
  /** Why only the planning documents are offered. */
  failure: string | null;
  /** Every part an export can hold: whether the project has it, and whether it is ticked. */
  sections: readonly {
    section: ExportSection;
    available: boolean;
    chosen: boolean;
  }[];
  onChoose: (section: ExportSection, chosen: boolean) => void;
  onExport: () => void;
  onClose: () => void;
};

/** Offers the sections the project has; a failed check offers the planning documents and says why. */
export function ExportDialogView({
  loading,
  failure,
  sections,
  onChoose,
  onExport,
  onClose,
}: ExportDialogViewProps) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{wording.exportProject.title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <p role="status">{wording.exportProject.loading}</p>
          ) : null}
          {failure === null ? null : <Fault>{failure}</Fault>}
          {sections.map(({ section, available, chosen }) => (
            <Checkbox
              key={section}
              label={wording.exportProject.sections[section]}
              checked={chosen}
              disabled={!available}
              onCheckedChange={(checked) => onChoose(section, checked)}
            />
          ))}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{wording.action.cancel}</Button>
          <Button
            variant="primary"
            disabled={!sections.some(({ chosen }) => chosen)}
            onClick={onExport}
          >
            {wording.exportProject.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type ProjectInfoDialogViewProps = {
  /** The project's name as saved, which heads the dialog. */
  title: string;
  /** The name as typed; nothing is written until Save. */
  name: string;
  onNameChange: (name: string) => void;
  /** Open with the name field focused (the menu's Rename). */
  focusName: boolean;
  /** When the project was created, where its host knows; else null. */
  created: string | null;
  state: "active" | "shipped" | "archived";
  /** The typed name is one worth keeping: not blank, and not the saved one. */
  canSave: boolean;
  saving: boolean;
  archiving: boolean;
  onSave: () => void;
  onToggleArchived: () => void;
  onClose: () => void;
};

export function ProjectInfoDialogView({
  title,
  name,
  onNameChange,
  focusName,
  created,
  state,
  canSave,
  saving,
  archiving,
  onSave,
  onToggleArchived,
  onClose,
}: ProjectInfoDialogViewProps) {
  const nameId = `project-name-${useId()}`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className={styles.info}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field>
            <label htmlFor={nameId}>Name</label>
            <Dictated value={name} onValueChange={onNameChange} align="center">
              <Input
                id={nameId}
                autoFocus={focusName}
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSave();
                  if (event.key === "Escape") onNameChange(title);
                }}
                aria-label="Project name"
              />
            </Dictated>
          </Field>
          <dl className={styles.facts}>
            {created !== null ? (
              <div>
                <dt>Created</dt>
                <dd>{created}</dd>
              </div>
            ) : null}
            <div>
              <dt>State</dt>
              <dd>{wording.status[state]}</dd>
            </div>
          </dl>
        </DialogBody>
        <DialogFooter>
          <Button
            loading={archiving}
            disabled={saving}
            onClick={onToggleArchived}
          >
            {state === "archived"
              ? wording.action.unarchive
              : wording.action.archive}
          </Button>
          {/* Deleting is the menu's two-step affair, not part of editing a
              project's info. */}
          <Button
            variant="primary"
            loading={saving}
            disabled={!canSave || archiving}
            onClick={onSave}
          >
            {saving ? wording.action.saving : wording.action.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
