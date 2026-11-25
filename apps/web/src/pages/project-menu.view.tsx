/**
 * A project's options menu as it looks, with the dialogs it opens: rename and
 * export.
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

export type ProjectMenuViewProps = {
  /** The element that opens the menu: the rail row's ellipsis, the top bar's title. */
  trigger: ReactElement;
  align: "start" | "end";
  side: "bottom" | "right";
  sideOffset: number;
  /** An archived project refuses every change until it is unarchived, so it offers only that. */
  archived: boolean;
  /** A shipped project offers to reopen rather than to mark it shipped. */
  shipped: boolean;
  onRename: () => void;
  onExport: () => void;
  onToggleShipped: () => void;
  onToggleArchived: () => void;
  onDelete: () => void;
  /** The rename dialog while it is open, else null. */
  renameDialog: ReactNode;
  /** The export dialog while it is open, else null. */
  exportDialog: ReactNode;
};

export function ProjectMenuView({
  trigger,
  align,
  side,
  sideOffset,
  archived,
  shipped,
  onRename,
  onExport,
  onToggleShipped,
  onToggleArchived,
  onDelete,
  renameDialog,
  exportDialog,
}: ProjectMenuViewProps) {
  // Archiving and deleting take two clicks, both in the menu: the second item
  // only exists after the first, so a slip cannot remove or hide a project.
  const [confirming, setConfirming] = useState<"archive" | "delete" | null>(
    null,
  );

  return (
    <>
      <Menu
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <MenuTrigger asChild>{trigger}</MenuTrigger>
        <MenuContent
          className={styles.menu}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <MenuItem onSelect={onRename}>Rename</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={onExport}>Export</MenuItem>
          {archived ? null : (
            <MenuItem onSelect={onToggleShipped}>
              {shipped ? wording.action.reopen : wording.action.markShipped}
            </MenuItem>
          )}
          <MenuSeparator />
          {archived ? (
            <MenuItem onSelect={onToggleArchived}>
              {wording.action.unarchive}
            </MenuItem>
          ) : null}
          {archived || confirming === "archive" ? null : (
            <MenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirming("archive");
              }}
            >
              {wording.action.archive}…
            </MenuItem>
          )}
          {archived || confirming !== "archive" ? null : (
            <MenuItem onSelect={onToggleArchived}>Yes, archive it</MenuItem>
          )}
          <MenuSeparator />
          {confirming === "delete" ? (
            <DangerMenuItem onSelect={onDelete}>Yes, delete it</DangerMenuItem>
          ) : (
            <DangerMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setConfirming("delete");
              }}
            >
              Delete…
            </DangerMenuItem>
          )}
        </MenuContent>
      </Menu>
      {renameDialog === null ? null : (
        // Portaled, but React-nested in the host: its events bubble to a
        // card face's handlers unless stopped here, the same as the menu's.
        <div
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {renameDialog}
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

export type RenameDialogViewProps = {
  /** The name as typed; nothing is written until Save. */
  name: string;
  onNameChange: (name: string) => void;
  /** The typed name is one worth keeping: not blank, and not the saved one. */
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
};

export function RenameDialogView({
  name,
  onNameChange,
  canSave,
  saving,
  onSave,
  onClose,
}: RenameDialogViewProps) {
  const nameId = `project-name-${useId()}`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Field>
            <label htmlFor={nameId}>Name</label>
            <Input
              id={nameId}
              autoFocus
              onFocus={(event) => event.target.select()}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSave();
              }}
              aria-label="Project name"
            />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button disabled={saving} onClick={onClose}>
            {wording.action.cancel}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!canSave}
            onClick={onSave}
          >
            {saving ? wording.action.saving : wording.action.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
