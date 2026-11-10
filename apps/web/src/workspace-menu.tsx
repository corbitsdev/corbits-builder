/** The rail's top: the open workspace, and a menu of the person's others. */
import {
  useCreateWorkspace,
  useWorkspaceMenu,
  type CreateWorkspaceProps,
  type WorkspaceMenuProps,
} from "./workspace-menu.model.ts";
import {
  CreateWorkspaceDialogView,
  WorkspaceMenuView,
} from "./workspace-menu.view.tsx";

export function WorkspaceMenu(props: WorkspaceMenuProps) {
  const { view, createDialog } = useWorkspaceMenu(props);
  return (
    <>
      <WorkspaceMenuView {...view} />
      {createDialog === null ? null : (
        <CreateWorkspaceDialog {...createDialog} />
      )}
    </>
  );
}

function CreateWorkspaceDialog(props: CreateWorkspaceProps) {
  return <CreateWorkspaceDialogView {...useCreateWorkspace(props)} />;
}
