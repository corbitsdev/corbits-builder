import type { ComponentProps } from "react";
import styles from "./pill.module.css";

type PillProps =
  | ({ as: "button" } & Omit<ComponentProps<"button">, "className" | "type">)
  | ({ as: "div" } & Omit<ComponentProps<"div">, "className">);

/**
 * The small rounded chip that floats over the page near the prompt box: the status pill, and the
 * way back from the chat in full screen. As a button it answers the pointer; otherwise it only
 * says something.
 */
export function Pill(props: PillProps) {
  if (props.as === "div") {
    const { as: _, ...rest } = props;
    return <div {...rest} className={styles.pill} data-slot="pill" />;
  }
  const { as: _, ...rest } = props;
  return (
    <button {...rest} type="button" className={styles.pill} data-slot="pill" />
  );
}
