/**
 * What the workspace menu does. A workspace is one root tenant on the hub,
 * holding its own projects and its own model keys. The menu lists the hub's
 * own memberships and creates through the hub's own tenant creation; this
 * browser only remembers which one is open.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { productName } from "./config.ts";
import {
  createWorkspace,
  listWorkspaces,
  workspaceTenantId,
  type Workspace,
} from "./api/auth.ts";
import { humanFault } from "./pages/workspace/human-fault.ts";
import { queryClient } from "./queries/client.ts";
import { keys } from "./queries/keys.ts";
import type {
  CreateWorkspaceDialogViewProps,
  WorkspaceMenuViewProps,
} from "./workspace-menu.view.tsx";

export type WorkspaceMenuProps = {
  onOpen: (workspaceId: string) => void;
};

export function useWorkspaceMenu({ onOpen }: WorkspaceMenuProps): {
  view: WorkspaceMenuViewProps;
  /** What the dialog that names a new workspace needs while it is up. */
  createDialog: CreateWorkspaceProps | null;
} {
  const read = useQuery({
    queryKey: keys.workspaces,
    queryFn: async () => ({
      list: await listWorkspaces(),
      openId: await workspaceTenantId(),
    }),
  });
  const [naming, setNaming] = useState(false);
  const listed = read.data;
  const open = listed?.list.find((workspace) => workspace.id === listed.openId);

  return {
    view: {
      name: open?.name ?? productName,
      workspaces:
        listed === undefined
          ? []
          : listed.list.map(({ id, name }) => ({
              id,
              name,
              open: id === listed.openId,
            })),
      onOpen: (workspaceId) => {
        if (workspaceId !== listed?.openId) onOpen(workspaceId);
      },
      onCreate: () => setNaming(true),
    },
    createDialog: naming
      ? {
          onClose: () => setNaming(false),
          onOpen: (id) => {
            setNaming(false);
            onOpen(id);
          },
        }
      : null,
  };
}

export type CreateWorkspaceProps = {
  onClose: () => void;
  onOpen: (workspaceId: string) => void;
};

export function useCreateWorkspace({
  onClose,
  onOpen,
}: CreateWorkspaceProps): CreateWorkspaceDialogViewProps {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Workspace | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (busy || trimmed.length === 0) return;
    setBusy(true);
    try {
      setCreated(await createWorkspace(trimmed));
      void queryClient.invalidateQueries({ queryKey: keys.workspaces });
    } catch (cause) {
      toast.error(humanFault(cause, "The workspace could not be created."));
    } finally {
      setBusy(false);
    }
  };

  return {
    name,
    onNameChange: setName,
    creating: busy,
    created:
      created === null
        ? null
        : { name: created.name, onOpen: () => onOpen(created.id) },
    onCreate: () => void create(),
    onClose,
  };
}
