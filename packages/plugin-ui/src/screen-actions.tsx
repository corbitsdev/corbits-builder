/**
 * A question's one row of actions: the view's own buttons, then Cancel, then a quiet note. Cancel
 * comes from the host through `ScreenCancel`, so every screen and question card withdraws its
 * question the same way, inside its own card, without each view wiring it.
 */
import { createContext, useContext, type ReactNode } from "react";
import { Button } from "@corbits/react-ui";
import styles from "./screen-actions.module.css";

export type Cancel = {
  label: string;
  disabled: boolean;
  onCancel: () => void;
};

/** What the host puts around a question so its row of actions can withdraw it. */
export const ScreenCancel = createContext<Cancel | null>(null);

export function ScreenActions({
  note,
  children,
}: {
  /** A quiet line after the buttons, such as why the main one is disabled. */
  note?: string | undefined;
  /** The view's own actions, which Cancel follows; none leaves Cancel alone. */
  children?: ReactNode;
}) {
  const cancel = useContext(ScreenCancel);
  return (
    <div className={styles.actions}>
      {children}
      {cancel === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={cancel.disabled}
          onClick={cancel.onCancel}
        >
          {cancel.label}
        </Button>
      )}
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
    </div>
  );
}
