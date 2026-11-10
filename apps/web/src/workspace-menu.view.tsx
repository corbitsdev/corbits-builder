/**
 * The workspace menu as it looks: the open workspace at the rail's top with
 * a menu of the person's others, and the dialog that names a new one. The
 * list sits in a group of its own so a cross-workspace view can join it later
 * as a sibling entry.
 */
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
import { wording } from "./config.ts";
import { Button, Field } from "./components.jsx";
import { LogoMark } from "./flourish.tsx";
import styles from "./workspace-menu.module.css";

export type WorkspaceMenuViewProps = {
  /** The name on the rail: the open workspace's, or the product's until the list is read. */
  name: string;
  /** The person's workspaces; the open one is ticked. */
  workspaces: readonly { id: string; name: string; open: boolean }[];
  onOpen: (workspaceId: string) => void;
  onCreate: () => void;
};

export function WorkspaceMenuView({
  name,
  workspaces,
  onOpen,
  onCreate,
}: WorkspaceMenuViewProps) {
  return (
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
          {workspaces.map((workspace) => (
            <MenuItem key={workspace.id} onSelect={() => onOpen(workspace.id)}>
              <span className={styles.menuName}>{workspace.name}</span>
              {workspace.open ? (
                <Check aria-label="Open" className={styles.menuCheck} />
              ) : null}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem onSelect={onCreate}>
          <Plus aria-hidden="true" />
          {wording.workspace.create}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export type CreateWorkspaceDialogViewProps = {
  /** The name being typed. */
  name: string;
  onNameChange: (name: string) => void;
  /** The hub is creating the workspace; the form waits and the dialog stays. */
  creating: boolean;
  /** The new workspace once it exists; the dialog then offers to open it. */
  created: { name: string; onOpen: () => void } | null;
  onCreate: () => void;
  onClose: () => void;
};

/**
 * Naming a workspace, then saying what happens next: it is empty, and the
 * first thing it needs is a model, which opening it asks for.
 */
export function CreateWorkspaceDialogView({
  name,
  onNameChange,
  creating,
  created,
  onCreate,
  onClose,
}: CreateWorkspaceDialogViewProps) {
  const copy = wording.workspace;
  return (
    <Dialog
      open
      onOpenChange={(next) => (next || creating ? undefined : onClose())}
    >
      <DialogContent>
        {created === null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
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
                  disabled={creating}
                  onChange={(event) => onNameChange(event.target.value)}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" disabled={creating} onClick={onClose}>
                {wording.action.cancel}
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={creating}
                disabled={creating || name.trim().length === 0}
              >
                {creating ? copy.creating : copy.createAction}
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
              <Button variant="primary" onClick={created.onOpen}>
                {copy.openAction}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
