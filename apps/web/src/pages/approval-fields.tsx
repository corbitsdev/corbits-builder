/**
 * The compact reviewer fields shared by the approval rounds and the workspace approvals setting:
 * a stack of label-and-control rows, their borderless controls and their quiet buttons, and the
 * role a reviewer being entered is given.
 */
import { Button, Input } from "@corbits/react-ui";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { wording } from "../config.ts";
import styles from "./approval-fields.module.css";

const roundText = wording.approvalRound;

// The list's choice that opens the field for a persona of the person's own; no persona is called this.
const OTHER_PERSONA = "__other__";

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

/** A reviewer being entered. */
export type ReviewerDraft = {
  name: string;
  /** The persona picked from the list; "" while none is. */
  persona: string;
  /** A persona typed instead of picked; null while one from the list is picked. */
  customPersona: string | null;
  goal: string;
  email: string;
};

/**
 * The role of a reviewer being entered: a persona picked from the list, or "Other…" and one typed
 * into the field that opens under it. It sits in an `ApprovalFields` among the reviewer's other
 * fields.
 */
export function PersonaFields({
  reviewer,
  onChange,
  personas,
  label,
  placeholder,
  onKeepCustomPersona,
}: {
  reviewer: ReviewerDraft;
  onChange: (reviewer: ReviewerDraft) => void;
  /** The personas the list offers. */
  personas: readonly string[];
  /** Tells this reviewer's fields from another's in their accessible names, such as "Reviewer 2". */
  label?: string;
  /** The list's empty first choice, where a reviewer starts with no persona picked. */
  placeholder?: string;
  /** Keeps the typed persona in the list for next time, from an Add button beside it or Enter. */
  onKeepCustomPersona?: () => void;
}) {
  const named = (text: string) =>
    label === undefined ? text : `${label} ${text}`;
  return (
    <>
      <ApprovalField label={roundText.fieldLabels.role}>
        <LeanSelect
          aria-label={named(roundText.reviewerPersona)}
          value={
            reviewer.customPersona === null ? reviewer.persona : OTHER_PERSONA
          }
          onChange={(event) =>
            onChange(
              event.target.value === OTHER_PERSONA
                ? { ...reviewer, customPersona: "" }
                : {
                    ...reviewer,
                    persona: event.target.value,
                    customPersona: null,
                  },
            )
          }
        >
          {placeholder === undefined ? null : (
            <option value="">{placeholder}</option>
          )}
          {personas.map((persona) => (
            <option key={persona} value={persona}>
              {persona}
            </option>
          ))}
          <option value={OTHER_PERSONA}>{roundText.otherPersona}</option>
        </LeanSelect>
      </ApprovalField>
      {reviewer.customPersona === null ? null : (
        <ApprovalField label={roundText.customPersonaLabel}>
          <LeanInput
            aria-label={named(roundText.customPersonaLabel)}
            placeholder={roundText.customPersonaPlaceholder}
            value={reviewer.customPersona}
            onChange={(event) =>
              onChange({ ...reviewer, customPersona: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key !== "Enter" || onKeepCustomPersona === undefined)
                return;
              event.preventDefault();
              onKeepCustomPersona();
            }}
          />
          {onKeepCustomPersona === undefined ? null : (
            <FieldSaveButton type="button" onClick={onKeepCustomPersona}>
              {roundText.addCustomPersona}
            </FieldSaveButton>
          )}
        </ApprovalField>
      )}
    </>
  );
}
