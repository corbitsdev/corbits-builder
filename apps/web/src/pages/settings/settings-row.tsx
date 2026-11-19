import { useState, type ComponentProps, type ReactNode } from "react";
import { Button as UiButton } from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { Ellipsis } from "lucide-react";
import { DangerMenuItem } from "../../components.jsx";
import styles from "./settings-row.module.css";

/** A row's left column: its name in bold, then its hint, or one line per hint in a list. */
function SettingsRowKey({
  label,
  aside,
  hint,
  htmlFor,
}: {
  label?: ReactNode;
  aside?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string | undefined;
}) {
  const hints: readonly ReactNode[] = Array.isArray(hint) ? hint : [hint];
  let name: ReactNode = null;
  if (label !== undefined) name = <span className={styles.label}>{label}</span>;
  if (label !== undefined && htmlFor !== undefined)
    name = <label htmlFor={htmlFor}>{name}</label>;
  if (aside !== undefined)
    name = (
      <span className={styles.name}>
        {name}
        <span className={styles.aside}>{aside}</span>
      </span>
    );
  return (
    <div className={styles.key} data-slot="settings-row-key">
      {name}
      {hints.map((line, index) =>
        line === undefined || line === null || line === "" ? null : (
          <span key={index} className={styles.hint}>
            {line}
          </span>
        ),
      )}
    </div>
  );
}

/** A row's right column, when it holds more than a single control. */
export function SettingsRowValue({ children }: { children: ReactNode }) {
  return (
    <span className={styles.value} data-slot="settings-row-value">
      {children}
    </span>
  );
}

/**
 * One setting: its name and hint on the left, its control on the right. A row without a label
 * or hint is a bare action row. Code finds a row by its `data-slot`, and a highlighted one by
 * `data-highlighted`.
 */
export function SettingsRow({
  id,
  highlighted = false,
  layout = "spread",
  label,
  aside,
  hint,
  htmlFor,
  children,
}: {
  id?: string;
  highlighted?: boolean;
  /** `spread` pushes the control to the far edge; `columns` starts it in a column of its own,
   * so a group's controls line up under each other. */
  layout?: "spread" | "columns";
  label?: ReactNode;
  /** A muted note beside the label, such as where the setting is kept. */
  aside?: ReactNode;
  /** Muted lines under the label; a list puts each on its own line. */
  hint?: ReactNode;
  /** The control the label names, when the row holds one. */
  htmlFor?: string;
  children?: ReactNode;
}) {
  return (
    <div
      id={id}
      className={styles.row}
      data-slot="settings-row"
      data-highlighted={highlighted ? "" : undefined}
      data-layout={layout}
    >
      {label === undefined && hint === undefined ? null : (
        <SettingsRowKey
          label={label}
          aside={aside}
          hint={hint}
          htmlFor={htmlFor}
        />
      )}
      {children}
    </div>
  );
}

/** The text input of a Settings row; `token` is the narrow one a model's columns use. */
export function SettingsInput({
  size,
  ...props
}: Omit<ComponentProps<"input">, "className" | "size"> & {
  size?: "token";
}) {
  return (
    <input
      {...props}
      className={styles.input}
      data-slot="settings-input"
      data-size={size}
    />
  );
}

/**
 * A row's options menu: edit it, if it can be edited, or a destructive action that takes a second
 * click to confirm.
 */
export function SettingsRowActions({
  label,
  editLabel,
  dangerLabel,
  confirmLabel,
  editable,
  busy,
  autoFocus,
  onEdit,
  onConfirm,
}: {
  /** Names the menu's button for a screen reader. */
  label: string;
  editLabel: string;
  dangerLabel: string;
  confirmLabel: string;
  editable: boolean;
  /** Its last action is on its way to the hub; the items wait. */
  busy: boolean;
  autoFocus?: boolean;
  /** Absent when the row can never be edited, so the menu does not offer it. */
  onEdit?: (() => void) | undefined;
  onConfirm: () => void;
}) {
  // The destructive action takes two clicks, both in the menu, as deleting a project does.
  const [confirming, setConfirming] = useState(false);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) setConfirming(false);
      }}
    >
      <MenuTrigger asChild>
        <UiButton
          variant="ghost"
          size="icon"
          aria-label={label}
          autoFocus={autoFocus}
        >
          <Ellipsis aria-hidden="true" />
        </UiButton>
      </MenuTrigger>
      <MenuContent align="end">
        {onEdit === undefined ? null : (
          <>
            <MenuItem disabled={busy || !editable} onSelect={onEdit}>
              {editLabel}
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {confirming ? (
          <DangerMenuItem disabled={busy} onSelect={onConfirm}>
            {confirmLabel}
          </DangerMenuItem>
        ) : (
          <DangerMenuItem
            disabled={busy}
            onSelect={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            {dangerLabel}
          </DangerMenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}
