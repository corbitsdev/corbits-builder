import type { ComponentProps, ReactNode } from "react";
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
