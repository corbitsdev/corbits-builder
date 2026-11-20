// The points a publish question lists, and an address among them, opened in a new tab.
import type { ReactNode } from "react";
import styles from "./points.module.css";

export function Points({
  slot,
  children,
}: {
  slot: string;
  children: ReactNode;
}) {
  return (
    <ul className={styles.points} data-slot={slot}>
      {children}
    </ul>
  );
}

/** label names the link for assistive tech when the address alone would not say what it is. */
export function Address({ url, label }: { url: string; label?: string }) {
  return (
    <a
      className={styles.address}
      data-slot="publish-address"
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
    >
      {url}
    </a>
  );
}
