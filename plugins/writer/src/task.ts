import { INPUTS_DIRECTORY } from "@corbits-builder/schemas/app-files";
import type {
  ArtifactListItem,
  WriterDocumentKind,
} from "@corbits-builder/schemas/artifact";
import { NativeSpecialistAssignment } from "@corbits-builder/schemas/native-specialist";
import { SourceRef } from "@corbits-builder/schemas";
import { inputFileName } from "@corbits-builder/hub/workflows/input-file-tools";
import { writerTaskMessage } from "./contract.ts";
import { builder } from "../package.json";

/** The writer package that saves the document kind, as this plugin's manifest declares it. */
export function writerPackageFor(kind: WriterDocumentKind): string {
  const found = Object.entries(builder.packages).find(
    ([, declared]) => "files" in declared && declared.files === kind,
  );
  if (!found) throw new Error(`No writer package saves ${kind}`);
  return found[0];
}

type Source = typeof SourceRef.infer;

function sourceToken(ref: Source): string {
  const base = ref.artifactId + "@" + String(ref.version) + "@" + ref.sha256;
  return ref.locator === undefined ? base : base + "@" + ref.locator;
}

type Assignment = typeof NativeSpecialistAssignment.infer;

export function assignmentToWriterMessage(
  assignment: Assignment,
  available: readonly Pick<ArtifactListItem, "artifactId" | "kind" | "title">[],
  current?: Source,
): string {
  const checked = NativeSpecialistAssignment.assert(assignment);
  const refs = [checked.briefRef, ...checked.sourceRefs];
  if (current) refs.push(current);
  const documents = refs.map((ref) => {
    const document = available.find(
      (item) => item.artifactId === ref.artifactId,
    );
    if (!document) throw new Error("writer_source_not_filed");
    return {
      ref: sourceToken(ref),
      kind: document.kind,
      title: document.title,
      path: INPUTS_DIRECTORY + "/" + inputFileName(document),
    };
  });
  const input = {
    task: checked.instruction,
    documents,
    artifact: checked.kind,
  };
  if (current)
    return writerTaskMessage({ ...input, replaces: sourceToken(current) });
  return writerTaskMessage(input);
}
