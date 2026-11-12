import { NativeSpecialistAssignment } from "@corbits-builder/schemas/native-specialist";
import { SourceRef } from "@corbits-builder/schemas";
import {
  writerTaskMessage,
  type WorkerDocument,
} from "@corbits-builder/writer/contract";

type Source = typeof SourceRef.infer;

function sourceToken(ref: Source): string {
  const base = ref.artifactId + "@" + String(ref.version) + "@" + ref.sha256;
  return ref.locator === undefined ? base : base + "@" + ref.locator;
}

type Assignment = typeof NativeSpecialistAssignment.infer;

type SourceDocument = { kind: string; title: string; content: string };

// The documents travel in the assignment, read by the hub at the referenced versions, so the writer
// has nothing to look up (a writer given a read tool re-read kinds hunting for "the requester's answers").
// A task may carry no documents at all, when the writer starts a project's first one.
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

export async function assignmentToWriterMessage(
  assignment: Assignment,
  read: (ref: Source) => Promise<SourceDocument>,
  current?: Source,
): Promise<string> {
  const checked = NativeSpecialistAssignment.assert(assignment);
  return writerTask(
    {
      kind: checked.kind,
      instruction: checked.instruction,
      sources: [checked.briefRef, ...checked.sourceRefs],
      current,
    },
    read,
  );
}
