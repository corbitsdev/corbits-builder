/**
 * A project's options menu, the same wherever a project is named: the
 * rail row and the title in the top bar. Info (and rename),
 * export, the shipped mark, archive, and a two-step delete, matching
 * the project operations the hub offers. The dialogs it opens live here too,
 * so the menu is complete on its own.
 */
import type { ReactElement } from "react";
import {
  useExportDialog,
  useProjectInfoDialog,
  useProjectMenu,
  type ExportDialogProps,
  type ProjectInfoDialogProps,
  type ProjectMenuHost,
} from "./project-menu.model.ts";
import {
  ExportDialogView,
  ProjectInfoDialogView,
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
  alignOffset?: number;
};

export function ProjectMenu({
  trigger,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  alignOffset = 0,
  ...host
}: ProjectMenuProps) {
  const { view, infoDialog, exportDialog } = useProjectMenu(host);
  return (
    <ProjectMenuView
      {...view}
      trigger={trigger}
      align={align}
      side={side}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      infoDialog={
        infoDialog === null ? null : <ProjectInfoDialog {...infoDialog} />
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

function ProjectInfoDialog(props: ProjectInfoDialogProps) {
  return <ProjectInfoDialogView {...useProjectInfoDialog(props)} />;
}
