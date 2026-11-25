/**
 * One line saying how the project's app stands, which opens it. Until there is an app there is no
 * line. Its words change as the app starts, runs or stops, so they are read out as they change.
 */
import { ArrowUpRight } from "lucide-react";
import { wording } from "../../config.ts";
import styles from "./app-line.module.css";

const words = wording.projectShell;

export type AppLineProps = {
  app: "not_built" | keyof typeof words.appState;
  /** The app is on the page; the line is marked. */
  open: boolean;
  onOpen: () => void;
};

export function AppLine({ app, open, onOpen }: AppLineProps) {
  if (app === "not_built") return null;
  return (
    <button
      type="button"
      className={styles.app}
      data-state={app}
      data-current={open ? "" : undefined}
      title={words.openApp}
      onClick={onOpen}
    >
      {/* The library's success tone is the brand's orange, so the app's dot is drawn here, green
          while the app is up. Starting, it turns as a running step's does. */}
      <span className={styles.dot}>
        {app === "starting" ? (
          <Working />
        ) : (
          <span className={styles.appDot} data-state={app} />
        )}
      </span>
      <span className={styles.name} aria-live="polite">
        {words.appState[app]}
      </span>
      <ArrowUpRight className={styles.go} aria-hidden="true" />
    </button>
  );
}

/**
 * Builder is working on it: a faint ring with one arc turning round it, drawn at the size of the
 * line's dot so it sits in the same column.
 */
function Working() {
  return (
    <svg className={styles.working} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5" data-part="track" />
      <path d="M7 2a5 5 0 0 1 5 5" data-part="arc" />
    </svg>
  );
}
