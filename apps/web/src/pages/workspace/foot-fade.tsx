/**
 * Fades whatever scrolls under the foot of a view into the backdrop, so a box floating there reads
 * clearly over it. It covers the foot of its nearest positioned parent and takes no presses.
 */
import styles from "./foot-fade.module.css";

export function FootFade() {
  return <div className={styles.fade} aria-hidden="true" />;
}
