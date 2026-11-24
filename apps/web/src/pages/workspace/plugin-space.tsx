/**
 * The space where a plugin's screen for the page opens: the ground right of the chat, or the whole
 * page over the conversation where that ground is too narrow. It is not a panel of its own, so it
 * draws no bar, rule, label or Close: the screen the plugin sends stands on the room's ground, and
 * answering it, or Not now in the prompt box, puts it away. Its heading, read out rather than shown
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
