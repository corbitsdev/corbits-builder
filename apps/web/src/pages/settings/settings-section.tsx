import type { ReactNode } from "react";
import styles from "./settings-section.module.css";

/** A section's rows, with the banners, notes and paragraphs between them. */
export function SettingsSectionBody({ children }: { children: ReactNode }) {
  return (
    <div className={styles.body} data-slot="settings-section-body">
      {children}
    </div>
  );
}

/** A heading for a group of rows inside a section. */
export function SettingsSubhead({ children }: { children: ReactNode }) {
  return (
    <h3 className={styles.subhead} data-slot="settings-subhead">
      {children}
    </h3>
  );
}
