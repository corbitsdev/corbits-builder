/**
 * The first build's progress in one line, from what the hub saw of the run's
 * own write events: how many files it has written, the last of them, and how
 * long since anything happened. The quiet time ticks on the caller's clock,
 * so the line changes every second even while one long step says nothing.
 */
import type { RunProgress } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { fileLabel } from "./agent-activity.tsx";

const text = wording.liveApp.setup;

/** How long ago, in a person's words: "just now", "40 s ago", "3 min ago". */
export function ago(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 5) return text.justNow;
  if (seconds < 120) return text.secondsAgo(seconds);
  return text.minutesAgo(Math.floor(seconds / 60));
}

export function setupProgressLine(
  progress: RunProgress | undefined,
  quietMs: number,
): string | undefined {
  if (progress === undefined) return undefined;
  const last = progress.files.at(-1);
  return progress.filesWritten === 0
    ? text.nothingYet(ago(quietMs))
    : text.progress(
        progress.filesWritten,
        last === undefined ? undefined : fileLabel(last),
        ago(quietMs),
      );
}
