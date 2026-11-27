import type { ReactNode } from "react";
import styles from "./source-link.module.css";

/** A link-styled button that opens one of an approval package's source documents. */
export function SourceLink({
  version = false,
  onClick,
  children,
}: {
  /** Set on a version number, which reads in the mono face. */
  version?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.sourceLink}
      data-slot="source-link"
      data-version={version ? "" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
