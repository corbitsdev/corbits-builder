import { SourceRef } from "@corbits-builder/schemas";
import type { WriterDocumentKind } from "@corbits-builder/schemas/artifact";
import { writerTaskMessage, type WorkerDocument } from "./contract.ts";

type Source = typeof SourceRef.infer;

// The writer package of each document with fields and a template of its own, and the one that
// writes any other document under the kind its task names.
export const WRITER_PACKAGES = {
  product_requirements: "writer-product-requirements",
  build_plan: "writer-build-plan",
} as const satisfies Record<WriterDocumentKind, string>;
export const DOCUMENT_WRITER_PACKAGE = "writer-document";

// The stack suggested to a build plan for a web app when neither the project nor the person names one.
export const WEB_APP_STACK =
  "the coder's web starter, a Bun workspace with client/ (Vite, React, React Router, TanStack Query, Tailwind CSS v4 and @corbits/react-ui), server/ (Hono on Bun, static JSON data or PGlite with Drizzle when the app stores what people enter) and packages/shared (zod schemas both sides use).";

function sourceToken(ref: Source): string {
  const base = ref.artifactId + "@" + String(ref.version) + "@" + ref.sha256;
  return ref.locator === undefined ? base : base + "@" + ref.locator;
}

type SourceDocument = { kind: string; title: string; content: string };

// The documents travel in the assignment, read by the hub at the referenced versions, so the writer
// has nothing to look up (a writer given a read tool re-read kinds hunting for "the requester's answers").
// A task may carry no documents at all.
export async function writerTask(
  task: {
    kind: string;
    instruction: string;
    sources: readonly Source[];
    current?: Source | undefined;
  },
  read: (ref: Source) => Promise<SourceDocument>,
): Promise<string> {
  const { current } = task;
  const refs = [...task.sources, ...(current ? [current] : [])];
  const documents: WorkerDocument[] = await Promise.all(
    refs.map(async (ref) => ({ ref: sourceToken(ref), ...(await read(ref)) })),
  );
  return writerTaskMessage({
    task: task.instruction,
    documents,
    artifact: task.kind,
    ...(current === undefined ? {} : { replaces: sourceToken(current) }),
  });
}
