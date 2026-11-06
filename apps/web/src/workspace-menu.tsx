/**
 * The rail's top: the open workspace, and a menu of the person's others.
 *
 * A workspace is one root tenant on the hub, holding its own projects and
 * its own model keys. The menu lists the hub's own memberships and creates
 * through the hub's own tenant creation; this browser only remembers which
 * one is open. The list sits in a group of its own so a cross-workspace view
 * can join it later as a sibling entry.
 */
import { productName, wording } from "./config.ts";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@corbits/react-ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFieldLabel,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@corbits/react-ui/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Field } from "./components.jsx";
import styles from "./workspace-menu.module.css";
import { LogoMark } from "./flourish.tsx";
import {
  createWorkspace,
  listWorkspaces,
  workspaceTenantId,
  type Workspace,
} from "./api/auth.ts";
import { humanFault } from "./pages/workspace/human-fault.ts";
import { queryClient } from "./queries/client.ts";
import { keys } from "./queries/keys.ts";

export function WorkspaceMenu({
  onOpen,
}: {
  onOpen: (workspaceId: string) => void;
}) {
  const read = useQuery({
    queryKey: keys.workspaces,
    queryFn: async () => ({
      list: await listWorkspaces(),
      openId: await workspaceTenantId(),
    }),
  });
  const [creating, setCreating] = useState(false);
  const open = read.data?.list.find(
    (workspace) => workspace.id === read.data?.openId,
  );
  const name = open?.name ?? productName;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className={styles.trigger}
            aria-label={wording.workspace.menu(name)}
          >
            <LogoMark size={20} />
            <span className={styles.name}>{name}</span>
            <ChevronDown className={styles.chevron} aria-hidden="true" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className={styles.menu}>
          <MenuGroup>
            <MenuLabel>{wording.workspace.listLabel}</MenuLabel>
            {read.data?.list.map((workspace) => (
              <MenuItem
                key={workspace.id}
                onSelect={() => {
                  if (workspace.id !== read.data?.openId) onOpen(workspace.id);
                }}
              >
                <span className={styles.menuName}>{workspace.name}</span>
                {workspace.id === read.data?.openId ? (
                  <Check aria-label="Open" className={styles.menuCheck} />
                ) : null}
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {wording.workspace.create}
          </MenuItem>
        </MenuContent>
      </Menu>
      {creating ? (
        <CreateWorkspaceDialog
          onClose={() => setCreating(false)}
          onOpen={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Naming a workspace, then saying what happens next: it is empty, and the
 * first thing it needs is a model, which opening it asks for.
 */
function CreateWorkspaceDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (workspaceId: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Workspace | null>(null);
  const copy = wording.workspace;

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

  return (
    <Dialog
      open
      onOpenChange={(next) => (next || busy ? undefined : onClose())}
    >
      <DialogContent>
        {created === null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <DialogHeader>
              <DialogTitle>{copy.createTitle}</DialogTitle>
              <DialogDescription>{copy.createLead}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field>
                <DialogFieldLabel htmlFor="workspace-name">
                  {copy.nameLabel}
                </DialogFieldLabel>
                <Input
                  id="workspace-name"
                  autoFocus
                  autoComplete="off"
                  placeholder={copy.namePlaceholder}
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                {wording.action.cancel}
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={busy}
                disabled={busy || name.trim().length === 0}
              >
                {busy ? copy.creating : copy.createAction}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{copy.createdTitle(created.name)}</DialogTitle>
              <DialogDescription>{copy.createdLead}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="primary" onClick={() => onOpen(created.id)}>
                {copy.openAction}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
