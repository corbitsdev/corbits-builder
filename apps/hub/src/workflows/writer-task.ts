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
export async function assignmentToWriterMessage(
  assignment: Assignment,
  read: (ref: Source) => Promise<SourceDocument>,
  current?: Source,
): Promise<string> {
  const checked = NativeSpecialistAssignment.assert(assignment);
  const refs = [
    checked.briefRef,
    ...checked.sourceRefs,
    ...(current ? [current] : []),
  ];
  const documents: WorkerDocument[] = await Promise.all(
    refs.map(async (ref) => ({ ref: sourceToken(ref), ...(await read(ref)) })),
  );
  return writerTaskMessage({
    task: checked.instruction,
    documents,
    artifact: checked.kind,
    ...(current === undefined ? {} : { replaces: sourceToken(current) }),
  });
}
