/**
 * A specialist's reports as they sit in the thread: one collapsed tool call named by what the
 * reports were about over the latest one's first line, opening to all of them, and several such
 * rows in a row gathered in one list.
 */
import {
  ConversationItem,
  Tool,
  ToolHeader,
  ToolOutput,
} from "@corbits/react-ui";
import { wording } from "../../../config.ts";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import { ThreadList } from "./thread-list.tsx";
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

/** Report rows in a row, in one list under a line that counts the reports; a long run opens folded. */
export function FoldedUpdatesView({
  rows,
  startHidden,
}: {
  rows: readonly UpdatesRow[];
  startHidden: boolean;
}) {
  const count = rows.reduce((sum, row) => sum + row.reports.length, 0);
  return (
    <ConversationItem itemId={`folded:${rows[0]?.key ?? ""}`}>
      <ThreadList
        label={wording.updatesFolded(count)}
        startHidden={startHidden}
      >
        {rows.map((row) => (
          <UpdateRow key={row.key} row={row} />
        ))}
      </ThreadList>
    </ConversationItem>
  );
}
