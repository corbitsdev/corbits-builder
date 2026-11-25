/**
 * A project's options menu, the same wherever a project is named: the
 * rail row and the title in the top bar. Rename,
 * export, the shipped mark, a two-step archive and a two-step delete,
 * matching the project operations the hub offers. The dialogs it opens live
 * here too, so the menu is complete on its own.
 */
import type { ReactElement } from "react";
import {
  useExportDialog,
  useRenameDialog,
  useProjectMenu,
  type ExportDialogProps,
  type RenameDialogProps,
  type ProjectMenuHost,
} from "./project-menu.model.ts";
import {
  ExportDialogView,
  RenameDialogView,
  ProjectMenuView,
} from "./project-menu.view.tsx";

type ProjectMenuProps = ProjectMenuHost & {
  /** The element that opens the menu: the rail row's ellipsis, the top bar's title. */
  trigger: ReactElement;
  align?: "start" | "end";
  /** Which side of the trigger it opens on: below it, or beside it to the right. */
  side?: "bottom" | "right";
  /** How far it opens from the trigger, along that side and across it. */
  sideOffset?: number;
};

export function ProjectMenu({
  trigger,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  ...host
}: ProjectMenuProps) {
  const { view, renameDialog, exportDialog } = useProjectMenu(host);
  return (
    <ProjectMenuView
      {...view}
      trigger={trigger}
      align={align}
      side={side}
      sideOffset={sideOffset}
      renameDialog={
        renameDialog === null ? null : <RenameDialog {...renameDialog} />
      }
      exportDialog={
        exportDialog === null ? null : <ExportDialog {...exportDialog} />
      }
    />
  );
}

function ExportDialog(props: ExportDialogProps) {
  return <ExportDialogView {...useExportDialog(props)} />;
}

function RenameDialog(props: RenameDialogProps) {
  return <RenameDialogView {...useRenameDialog(props)} />;
}
