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

export function Address({ url }: { url: string }) {
  return (
    <a className={styles.address} href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}
