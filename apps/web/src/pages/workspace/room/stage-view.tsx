import type { ComponentProps } from "react";
import styles from "./stage-view.module.css";

/** The frame each state of the room fills the stage with: loading, failed or open. */
export function StageView(props: Omit<ComponentProps<"div">, "className">) {
  return <div {...props} className={styles.stageView} data-slot="stage-view" />;
}
