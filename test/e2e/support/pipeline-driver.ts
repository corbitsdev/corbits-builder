import { join } from "node:path";
import { type } from "arktype";
import type { ProjectArtifact } from "@corbits-builder/client";

export const FIXTURE_DIR = join(
  import.meta.dir,
  "..",
  "..",
  "fixtures",
  "pipeline",
);
export const STAGE_DEADLINE_MS = 180_000;

export const NonEmptyString = type("string > 0");

function isQuestionPark(event: {
  type: string;
  body: Record<string, unknown>;
}): boolean {
  return (
    event.type === "SignalAwaited" && event.body["parkKind"] === "question"
  );
}

export function openQuestionPark<
  Event extends { type: string; body: Record<string, unknown> },
>(events: readonly Event[]): Event | undefined {
  return events.find(
    (event) =>
      isQuestionPark(event) &&
      !events.some(
        (later) =>
          later.type === "SignalReceived" &&
          later.body["signalName"] === event.body["signalName"],
      ),
  );
}

export function findArtifact(
  artifacts: readonly ProjectArtifact[],
  kind: string,
  version?: number,
): ProjectArtifact | undefined {
  return artifacts.find(
    (item) =>
      item.kind === kind && (version === undefined || item.version === version),
  );
}
