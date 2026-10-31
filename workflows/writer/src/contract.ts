import { type } from "arktype";

// The first message is the whole assignment: the task, the documents it builds on in full, the one
// kind to write, and, when that kind is already filed, the version this one replaces.
const Document = type({
  "+": "reject",
  ref: "string > 0",
  kind: "string > 0",
  title: "string > 0",
  content: "string",
});
const WorkerTask = type({
  "+": "reject",
  type: "'writer.task'",
  task: "string > 0",
  documents: Document.array().atLeastLength(1),
  artifact: "string > 0",
  "replaces?": "string > 0",
});
export type WorkerDocument = typeof Document.infer;

export function writerTaskMessage(input: {
  readonly task: string;
  readonly documents: readonly WorkerDocument[];
  readonly artifact: string;
  readonly replaces?: string;
}): string {
  return JSON.stringify(
    WorkerTask.assert({
      type: "writer.task",
      task: input.task.trim(),
      documents: input.documents,
      artifact: input.artifact,
      ...(input.replaces === undefined ? {} : { replaces: input.replaces }),
    }),
  );
}
