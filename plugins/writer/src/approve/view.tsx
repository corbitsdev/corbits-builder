import type {
  ScreenViewProps,
  ShownDocument,
} from "@corbits-builder/plugin-ui/screen";
/**
 * The ask to approve the documents, as one card: what is asked, a lone document's own summary in
 * a line, and each document as a chip that opens it. The host answers it from the screen's
 * decision: one Approve for them all, or what the person types in the prompt box. Settles to one
 * line once answered.
 */
import { DocumentBlock } from "@corbits-builder/plugin-ui/document-block";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettledLine,
} from "@corbits-builder/plugin-ui/screen-card";
import { filedOf, type Host } from "./definition.ts";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer,
  Host
>;

// A lone document is named by its own kind, so any document reads by name, such as the user manual.
const named = (kind: string) => `the ${kind.replaceAll("_", " ")}`;

export const text = {
  title: "Approve the documents",
  ask: ([only, ...others]: readonly string[]) =>
    only !== undefined && others.length === 0
      ? `Review ${named(only)}`
      : `Review these ${String(others.length + 1)} documents`,
  approved: "already approved",
  notFiled: (kind: string) => `${kind} is not filed yet.`,
  noDocuments: "The documents cannot be shown here.",
  // A lone document is named by its kind; several are listed by their titles.
  settled: (kinds: readonly string[], titles: ReadonlyMap<string, string>) => {
    const [only] = kinds;
    return only !== undefined && kinds.length === 1
      ? `You approved ${named(only)}`
      : `You approved ${kinds.map((kind) => titles.get(kind) ?? kind).join(", ")}`;
  },
};

const NONE: readonly ShownDocument[] = [];

export function ApproveDocuments({
  prepared: { input, resources: host },
  answer,
  openDocument,
}: Props) {
  const list = host?.documents.list;
  const { filed, missing } = filedOf(list ?? NONE, input.kinds);
  if (answer !== undefined) {
    const titles = new Map(
      host?.documents.list.map((document) => [document.kind, document.title]),
    );
    return (
      <ScreenSettledLine>
        {text.settled(
          answer.approved.map(({ kind }) => kind),
          titles,
        )}
      </ScreenSettledLine>
    );
  }
  if (host === undefined)
    return <p className={styles.hint}>{text.noDocuments}</p>;
  if (openDocument === undefined)
    throw new Error("The document approval screen requires openDocument.");
  const open = openDocument;
  // A lone document's own summary says what is being approved; several speak through their chips.
  const [only, ...others] = filed;
  const summary =
    only !== undefined && others.length === 0 && missing.length === 0
      ? only.summary
      : undefined;
  return (
    <ScreenCard title={text.ask(input.kinds)} actions={<ScreenActions />}>
      {summary === undefined ? null : (
        <div className={styles.summary}>
          <Markdown source={summary} />
        </div>
      )}
      <ul className={styles.documents} data-slot="approve-documents">
        {filed.map((document) => (
          <li key={document.kind}>
            <DocumentBlock
              compact
              kind={document.kind}
              title={document.title}
              version={document.version}
              note={
                document.approvedVersion === document.version
                  ? text.approved
                  : undefined
              }
              onOpen={open}
            />
          </li>
        ))}
        {missing.map((kind) => (
          <li key={kind} className={styles.meta}>
            {text.notFiled(kind)}
          </li>
        ))}
      </ul>
    </ScreenCard>
  );
}

export default ApproveDocuments;
