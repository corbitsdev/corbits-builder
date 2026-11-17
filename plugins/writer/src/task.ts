import { SourceRef } from "@corbits-builder/schemas";
import { type Filed } from "@corbits-builder/plugin";
import type { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import { writerTaskMessage } from "./contract.ts";

type Source = typeof SourceRef.infer;

// The document each writer package with fields and a template of its own files, and the package
// that writes any other document under the kind its task names.
export const WRITER_KINDS = {
  "writer-product-requirements": "product_requirements",
  "writer-build-plan": "build_plan",
} as const satisfies Record<string, WriterDocumentKind>;
export const DOCUMENT_WRITER_PACKAGE = "writer-document";

function sourceToken(ref: Source): string {
  const base = ref.artifactId + "@" + String(ref.version) + "@" + ref.sha256;
  return ref.locator === undefined ? base : base + "@" + ref.locator;
}

// The task names each document by the path its read_file reads; a task may name none at all.
export function writerTask(
  task: {
    kind: string;
    instruction: string;
    sources: readonly Source[];
    current?: Source | undefined;
  },
  document: Filed["document"],
): string {
  const { current } = task;
  const refs = [...task.sources, ...(current ? [current] : [])];
  const documents = refs.map((ref) => ({
    ref: sourceToken(ref),
    ...document(ref),
  }));
  return writerTaskMessage({
    task: task.instruction,
    documents,
    artifact: task.kind,
    ...(current === undefined ? {} : { replaces: sourceToken(current) }),
  });
}
