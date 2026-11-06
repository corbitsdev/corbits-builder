import type { ReactNode } from "react";
import { DialogBody } from "@corbits/react-ui/ui/dialog";
import styles from "./provider-form.module.css";

/** The body of a provider or profile dialog: its fields stacked, or laid out as Settings rows. */
export function ProviderFormBody({
  rows = false,
  children,
}: {
  rows?: boolean;
  children: ReactNode;
}) {
  return (
    <DialogBody className={styles.form} data-rows={rows ? "" : undefined}>
      {children}
    </DialogBody>
  );
}
