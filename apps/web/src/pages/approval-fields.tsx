/**
 * The compact reviewer fields shared by the approval rounds and the workspace approvals setting:
 * a stack of label-and-control rows, their borderless controls and their quiet buttons.
 */
import { Button, Input } from "@corbits/react-ui";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import styles from "./approval-fields.module.css";

type FieldsVariant = "inline" | "form";

/** Which variant of `ApprovalFields` a row or control sits in; outside one it is inline. */
const FieldsVariantContext = createContext<FieldsVariant>("inline");

/**
 * A stack of reviewer fields. The `form` variant boxes its controls and drops the action column,
 * for entering a new reviewer; `separated` rules it off from what sits above.
 */
export function ApprovalFields({
  variant = "inline",
  separated = false,
  children,
  ...props
}: {
  variant?: FieldsVariant;
  separated?: boolean;
  children: ReactNode;
} & Pick<ComponentProps<"div">, "role" | "aria-label">) {
  return (
    <div
      {...props}
      className={styles.fields}
      data-slot="approval-fields"
      data-variant={variant}
      data-separated={separated ? "" : undefined}
    >
      <FieldsVariantContext value={variant}>{children}</FieldsVariantContext>
    </div>
  );
}

/** One field: its label, its control, and in the inline variant an action beside it. */
export function ApprovalField({
  label,
  action,
  title,
  children,
}: {
  label: ReactNode;
  /** Present (even when null) in the inline variant, so every row keeps its action column. */
  action?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const variant = useContext(FieldsVariantContext);
  return (
    <div
      className={styles.row}
      data-slot="approval-field"
      data-variant={variant}
    >
      <span className={styles.label}>{label}</span>
      <div className={styles.control} title={title}>
        {children}
      </div>
      {action === undefined ? null : <div>{action}</div>}
    </div>
  );
}

/** A borderless text input that shows its edge on hover and focus, boxed in a form. */
export function LeanInput(
  props: Omit<ComponentProps<typeof Input>, "className">,
) {
  const variant = useContext(FieldsVariantContext);
  return (
    <Input
      {...props}
      className={styles.leanControl}
      data-slot="lean-input"
      data-variant={variant}
    />
  );
}

/** The select that matches `LeanInput`. */
export function LeanSelect(props: Omit<ComponentProps<"select">, "className">) {
  const variant = useContext(FieldsVariantContext);
  return (
    <select
      {...props}
      className={styles.leanControl}
      data-slot="lean-select"
      data-variant={variant}
    />
  );
}

/** The outlined button that saves one field or adds an entry. */
export function FieldSaveButton(
  props: Omit<ComponentProps<typeof Button>, "className" | "size" | "variant">,
) {
  return (
    <Button
      {...props}
      size="sm"
      variant="outline"
      className={styles.saveButton}
      data-action="save"
    />
  );
}

/** A quiet text button for the secondary actions around reviewers. */
export function LeanButton(
  props: Omit<ComponentProps<typeof Button>, "className" | "size" | "variant">,
) {
  return (
    <Button
      {...props}
      size="sm"
      variant="ghost"
      className={styles.leanButton}
    />
  );
}
