/**
 * Things the person weighs side by side and picks one of: each with a body the screen fills (a
 * frame, a picture, text), an optional short note and, where the screen takes them, a comment.
 * The items stack on a narrow screen. Stateless: the pick and the comments come in as props, and
 * every change goes out as an event.
 */
import { useId, type ReactNode } from "react";
import { Card, Textarea } from "@corbits/react-ui";
import styles from "./comparison.module.css";

export type ComparisonItem = {
  /** Names the item in the events; unique among the items. */
  id: string;
  title: string;
  /** What the screen draws of the item. */
  body: ReactNode;
  /** A short line under the body, such as what sets the item apart. */
  note?: string | undefined;
};

export type ComparisonProps = {
  /** What the person is choosing, shown above the items and naming the group. */
  label: string;
  items: readonly ComparisonItem[];
  /** The id of the item picked, if any. */
  chosen: string | undefined;
  onChoose(id: string): void;
  /** A comment field on each item, its text by item id; without it the items take no comment. */
  comments?:
    | {
        label: string;
        maxLength: number;
        text: Readonly<Record<string, string>>;
        onChange(id: string, text: string): void;
      }
    | undefined;
  /** Nothing can be changed, such as while the choice is being sent. */
  disabled?: boolean | undefined;
};

export function Comparison({
  label,
  items,
  chosen,
  onChoose,
  comments,
  disabled = false,
}: ComparisonProps) {
  const group = useId();
  return (
    <fieldset
      className={styles.comparison}
      data-slot="comparison"
      disabled={disabled}
    >
      <legend className={styles.legend}>{label}</legend>
      <ul className={styles.items}>
        {items.map((item) => (
          <li key={item.id}>
            <Card
              className={styles.item}
              data-chosen={item.id === chosen ? "" : undefined}
            >
              <label className={styles.pick}>
                <input
                  type="radio"
                  name={group}
                  value={item.id}
                  checked={item.id === chosen}
                  onChange={() => onChoose(item.id)}
                />
                {item.title}
              </label>
              <div className={styles.body}>{item.body}</div>
              {item.note === undefined ? null : (
                <p className={styles.note}>{item.note}</p>
              )}
              {comments === undefined ? null : (
                <Textarea
                  aria-label={`${comments.label}: ${item.title}`}
                  placeholder={comments.label}
                  rows={2}
                  maxLength={comments.maxLength}
                  value={comments.text[item.id] ?? ""}
                  onChange={(event) =>
                    comments.onChange(item.id, event.target.value)
                  }
                />
              )}
            </Card>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
