/**
 * The label over a sidebar card's list, such as Plan or Files: small and quiet, so the rows under
 * it carry the eye and the label only names the group.
 */
import type { ReactNode } from "react";
import styles from "./sidebar-heading.module.css";

export function SidebarHeading({
  id,
  children,
}: {
  /** For a list named by the heading. */
  id?: string | undefined;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className={styles.heading} data-slot="sidebar-heading">
      {children}
    </h2>
  );
}
