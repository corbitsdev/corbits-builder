/**
 * The space where a plugin's screen for the page opens: the whole page over the conversation. It
 * is not a panel of its own, so it draws no bar, rule, label, padding or Close: the screen the
 * plugin sends fills the room's page, edge to edge as a pane's mockup does, and
 * answering it puts it away. Its heading, read out rather than shown
 * since the screen names itself, takes focus when the person opens it from the prompt box.
 */
import { useId, type ReactNode, type Ref } from "react";
import styles from "./plugin-space.module.css";

export function PluginSpace({
  title,
  headingRef,
  children,
}: {
  /** What the screen is, as the plugin names it. */
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <aside
      className={styles.space}
      data-slot="plugin-space"
      aria-labelledby={id}
    >
      <h2 ref={headingRef} id={id} className={styles.title} tabIndex={-1}>
        {title}
      </h2>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
