/**
 * The space where a plugin's screen opens: room beside the room's main area on a wide window, or a
 * sheet over it on a narrow one. It is not a panel of its own, so it draws no bar, rule or label:
 * the screen the plugin sends stands on the room's ground, with only Close above it. Its heading,
 * read out rather than shown since the screen names itself, takes focus when the person opens it
 * from the prompt box.
 */
import { useId, type ReactNode, type Ref } from "react";
import { X } from "lucide-react";
import { Button } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import styles from "./plugin-space.module.css";

const text = wording.promptBox.space;

export function PluginSpace({
  title,
  as,
  headingRef,
  onClose,
  hidden = false,
  children,
}: {
  /** What the screen is, as the plugin names it. */
  title: string;
  /** Beside the main area, or over it with the prompt box beneath. */
  as: "column" | "sheet";
  headingRef?: Ref<HTMLHeadingElement>;
  /** Puts the space away, the screen still waiting. */
  onClose?: (() => void) | undefined;
  /**
   * Closed while its screen still waits: kept mounted, so the screen's forward action stays in the
   * prompt box, which opens it.
   */
  hidden?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <aside
      className={styles.space}
      data-slot="plugin-space"
      data-as={as}
      aria-labelledby={id}
      hidden={hidden}
    >
      <header className={styles.head}>
        <h2 ref={headingRef} id={id} className={styles.title} tabIndex={-1}>
          {title}
        </h2>
        {onClose === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.close}
            aria-label={text.close}
            title={text.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        )}
      </header>
      <div className={styles.body}>{children}</div>
    </aside>
  );
}
