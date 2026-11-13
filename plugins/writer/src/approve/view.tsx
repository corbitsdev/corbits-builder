/**
 * The ask to approve the documents, as one card in the conversation: what is asked, each document
 * as the shared document block shows any filed document. The host answers it from the screen's
 * decision: one Approve for them all, or what the person types in the prompt box. Settles to one
 * line once answered.
 */
import { useEffect, useMemo } from "react";
import type { Offer, ScreenViewProps } from "@corbits-builder/plugin";
import {
  DocumentBlock,
  documentBlockText,
} from "@corbits-builder/plugin-ui/document-block";
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

// A lone document is named by its own kind, so any document reads by name, such as the user manual.
const named = (kind: string) => `the ${kind.replaceAll("_", " ")}`;

export const text = {
  title: "Approve the documents",
  ask: ([only, ...others]: readonly string[]) =>
    only !== undefined && others.length === 0
      ? `Approve ${named(only)}?`
      : `Approve these ${String(others.length + 1)} documents?`,
  approved: "already approved",
  notFiled: (kind: string) => `${kind} is not filed yet.`,
  unfiled: "Each document is approved once it is filed.",
  orType: "Or type what should change in the message box below.",
  noDocuments: "The documents cannot be shown here.",
  settled: (approved: readonly { title: string; version: number }[]) => {
    const [only, ...others] = approved;
    if (only !== undefined && others.length === 0)
      return `Approved, version ${String(only.version)}`;
    return `Approved ${approved
      .map(
        ({ title, version }) =>
          `${title} ${documentBlockText.version(version)}`,
      )
      .join(", ")}`;
  },
};

const NONE: readonly ShownDocument[] = [];

/** The documents asked for that are filed, and the kinds asked for that are not. */
export function filedOf(
  list: readonly ShownDocument[],
  kinds: readonly string[],
) {
  const filed = list.filter((document) => kinds.includes(document.kind));
  const missing = kinds.filter(
    (kind) => !filed.some((document) => document.kind === kind),
  );
  return { filed, missing };
}

/** What the card offers the host: approving every document asked for at the version shown, once all are filed. */
export const offerOf = (
  filed: readonly ShownDocument[],
  missing: readonly string[],
): Offer<typeof Output.infer> =>
  missing.length > 0
    ? { accept: { unavailable: text.unfiled } }
    : {
        accept: {
          output: {
            approved: filed.map(({ kind, artifactId, version }) => ({
              kind,
              artifactId,
              version,
            })),
          },
        },
      };

export function ApproveDocuments({ input, answer, host, offer }: Props) {
  const list = host?.documents.list;
  // Kept while the documents and kinds are, so the offer follows them, not each render.
  const { filed, missing } = useMemo(
    () => filedOf(list ?? NONE, input.kinds),
    [list, input.kinds],
  );
  useEffect(() => {
    offer?.(offerOf(filed, missing));
  }, [offer, filed, missing]);
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
  const { open } = host.documents;
  return (
    <ScreenCard
      title={text.ask(input.kinds)}
      actions={<ScreenActions note={text.orType} />}
    >
      <ul className={styles.documents} data-slot="approve-documents">
        {filed.map((document) => (
          <li key={document.kind}>
            <DocumentBlock
              kind={document.kind}
              title={document.title}
              version={document.version}
              note={
                document.approvedVersion === document.version
                  ? text.approved
                  : undefined
              }
              summary={document.summary}
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
