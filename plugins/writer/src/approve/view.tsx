/**
 * The documents the person is asked to approve, each at its current version with a way to open it,
 * and one Approve for them all. Settles to one line once answered.
 */
import { Button } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import type { Input, Output } from "./schema.ts";

/** A filed document at its current version, as the host lists it. */
export type ShownDocument = {
  kind: string;
  title: string;
  artifactId: string;
  version: number;
  approvedVersion?: number;
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

export const text = {
  title: "Approve the documents",
  version: (version: number) => `version ${String(version)}`,
  approved: "already approved",
  open: "Open",
  notFiled: (kind: string) => `${kind} is not filed yet.`,
  approve: "Approve",
  orWrite: "Or write below what should change.",
  noDocuments: "The documents cannot be shown here.",
  settled: (approved: readonly { kind: string; version: number }[]) =>
    `Approved ${approved.map(({ kind, version }) => `${kind} version ${String(version)}`).join(", ")}.`,
};

export function ApproveDocuments({
  input,
  submit,
  submitting,
  answer,
  host,
}: Props) {
  if (answer !== undefined) return <p>{text.settled(answer.approved)}</p>;
  if (host === undefined) return <p>{text.noDocuments}</p>;
  const { list, open } = host.documents;
  const filed = list.filter((document) => input.kinds.includes(document.kind));
  const missing = input.kinds.filter(
    (kind) => !filed.some((document) => document.kind === kind),
  );
  return (
    <section aria-label={text.title} data-slot="approve-documents">
      <ul>
        {filed.map((document) => (
          <li key={document.kind}>
            {document.title}, {text.version(document.version)}
            {document.approvedVersion === document.version
              ? `, ${text.approved}`
              : null}{" "}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => open(document.kind)}
            >
              {text.open}
            </Button>
          </li>
        ))}
        {missing.map((kind) => (
          <li key={kind}>{text.notFiled(kind)}</li>
        ))}
      </ul>
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
      <p>{text.orWrite}</p>
    </section>
  );
}

export default ApproveDocuments;
