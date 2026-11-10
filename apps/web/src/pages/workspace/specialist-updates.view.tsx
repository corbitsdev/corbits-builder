/**
 * A specialist's reports as they sit in the thread: one collapsed tool call named by what the
 * reports were about over the latest one's first line, opening to all of them, and a long run of
 * such rows folded under one line.
 */
import {
  ConversationItem,
  Tool,
  ToolHeader,
  ToolOutput,
} from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";
import styles from "./specialist-updates.module.css";

/** One specialist's consecutive reports, in the words their row shows. */
export type UpdatesRow = {
  /** Names the row among the thread's items. */
  key: string;
  /** What the reports were about, and how many: "Constraints" or "Build · 4 updates". */
  title: string;
  /** The latest report's first line. */
  summary: string | null;
  /** Each report in full, oldest first. */
  reports: readonly { at: number; text: string }[];
};

function UpdateRow({ row }: { row: UpdatesRow }) {
  return (
    <Tool
      part={{
        kind: "tool-trace",
        toolCallId: row.key,
        name: "",
        status: "output-available",
        output: row.reports.map((report) => report.text),
      }}
    >
      <ToolHeader
        className={styles.row}
        label={
          <>
            <span className={styles.names} data-slot="update-names">
              {row.title}
            </span>
            {row.summary === null ? null : (
              <span className={styles.summary}>{row.summary}</span>
            )}
          </>
        }
        statusLabels={{ "output-available": "" }}
      />
      <ToolOutput
        title={wording.reported}
        render={() =>
          row.reports.map((report) => (
            <div
              key={`${String(report.at)}:${report.text}`}
              className={styles.turn}
            >
              <Markdown source={report.text} />
            </div>
          ))
        }
      />
    </Tool>
  );
}

/** A finished specialist's reports as one tool call, where they happened in the thread. */
export function SpecialistUpdatesView({ row }: { row: UpdatesRow }) {
  return (
    <ConversationItem itemId={row.key}>
      <UpdateRow row={row} />
    </ConversationItem>
  );
}

/** A long run of report rows folded under one line, each row still there to open. */
export function FoldedUpdatesView({ rows }: { rows: readonly UpdatesRow[] }) {
  const count = rows.reduce((sum, row) => sum + row.reports.length, 0);
  return (
    <ConversationItem itemId={`folded:${rows[0]?.key ?? ""}`}>
      <details className={styles.fold}>
        <summary>{wording.updatesFolded(count)}</summary>
        {rows.map((row) => (
          <UpdateRow key={row.key} row={row} />
        ))}
      </details>
    </ConversationItem>
  );
}
