import { Badge } from "@corbits/react-ui";
import type { ReactNode } from "react";
import styles from "./settings-section.module.css";

/**
 * A titled group of settings: its title, a tag such as Experimental, and a lead on one line, then
 * its rows. A rule above each group but the first starts it.
 */
export function SettingsGroup({
  title,
  tag,
  lead,
  children,
}: {
  title: ReactNode;
  tag?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.group} data-slot="settings-group">
      <header className={styles.groupHead}>
        <h2>{title}</h2>
        {tag === undefined ? null : <Badge tone="accent">{tag}</Badge>}
        {lead === undefined ? null : <p>{lead}</p>}
      </header>
      {children}
    </section>
  );
}

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
