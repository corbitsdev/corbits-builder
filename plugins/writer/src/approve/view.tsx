/**
 * The ask to approve the documents, as one card in the conversation: what is asked, each document
 * at its current version with a way to open it, and one Approve for them all. Settles to one line
 * once answered.
 */
import { Button } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

/** A filed document at its current version, as the host lists it. */
export type ShownDocument = {
  kind: string;
  title: string;
  artifactId: string;
  version: number;
  approvedVersion?: number;
  /** The document's own `## In short` section, as markdown, when it has one. */
  summary?: string;
};

export type Host = {
  documents: { list: readonly ShownDocument[]; open(kind: string): void };
};

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer,
  Host
>;

// How the ask names a lone document by its kind; any other kind is "this document".
const NAMED: Record<string, string> = {
  problem_brief: "the problem brief",
  constraints: "the constraints",
  approaches: "the approaches",
  product_requirements: "the requirements",
  build_plan: "the build plan",
};

export const text = {
  title: "Approve the documents",
  ask: ([only, ...others]: readonly string[]) =>
    only !== undefined && others.length === 0
      ? `Approve ${NAMED[only] ?? "this document"}?`
      : `Approve these ${String(others.length + 1)} documents?`,
  version: (version: number) => `v${String(version)}`,
  approved: "already approved",
  open: "Open",
  notFiled: (kind: string) => `${kind} is not filed yet.`,
  approve: "Approve",
  orWrite: "Or write below what should change.",
  noDocuments: "The documents cannot be shown here.",
  settled: (approved: readonly { title: string; version: number }[]) => {
    const [only, ...others] = approved;
    if (only !== undefined && others.length === 0)
      return `Approved, version ${String(only.version)}`;
    return `Approved ${approved
      .map(({ title, version }) => `${title} ${text.version(version)}`)
      .join(", ")}`;
  },
};

export function ApproveDocuments({
  input,
  submit,
  submitting,
  answer,
  host,
}: Props) {
  if (answer !== undefined) {
    const titles = new Map(
      host?.documents.list.map((document) => [document.kind, document.title]),
    );
    return (
      <ScreenSettled
        asked={text.ask(answer.approved.map(({ kind }) => kind))}
        answer={text.settled(
          answer.approved.map(({ kind, version }) => ({
            title: titles.get(kind) ?? kind,
            version,
          })),
        )}
      />
    );
  }
  if (host === undefined)
    return <p className={styles.hint}>{text.noDocuments}</p>;
  const { list, open } = host.documents;
  const filed = list.filter((document) => input.kinds.includes(document.kind));
  const missing = input.kinds.filter(
    (kind) => !filed.some((document) => document.kind === kind),
  );
  return (
    <ScreenCard
      title={text.ask(input.kinds)}
      actions={
        <ScreenActions note={text.orWrite}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || missing.length > 0}
            onClick={() =>
              void submit({
                approved: filed.map(({ kind, artifactId, version }) => ({
                  kind,
                  artifactId,
                  version,
                })),
              })
            }
          >
            {text.approve}
          </Button>
        </ScreenActions>
      }
    >
      <ul className={styles.documents} data-slot="approve-documents">
        {filed.map((document) => (
          <li key={document.kind} className={styles.document}>
            <div className={styles.row}>
              <span className={styles.title} title={document.title}>
                {document.title}
              </span>
              <span className={styles.meta}>
                {text.version(document.version)}
                {document.approvedVersion === document.version
                  ? ` · ${text.approved}`
                  : null}
              </span>
              <Button
                type="button"
                size="sm"
                variant="link"
                className={styles.open}
                onClick={() => open(document.kind)}
              >
                {text.open}
              </Button>
            </div>
            {document.summary === undefined ? null : (
              <div className={styles.summary}>
                <Markdown source={document.summary} />
              </div>
            )}
          </li>
        ))}
        {missing.map((kind) => (
          <li key={kind} className={styles.row}>
            <span className={styles.meta}>{text.notFiled(kind)}</span>
          </li>
        ))}
      </ul>
    </ScreenCard>
  );
}

export default ApproveDocuments;
