/** The version of each document this viewer last opened, kept in this browser. */
import { useMemo } from "react";
import { type } from "arktype";
import { readJson } from "../../json.ts";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";

const SEEN_KEY = "builder-seen-document-versions";

export type SeenVersions = Readonly<Record<string, number>>;

const Seen = type({ "[string]": "number" });
// Nothing stored, or nothing readable, means no version has been opened yet.
const NONE_SEEN: SeenVersions = {};

function parseSeen(raw: string): SeenVersions {
  return readJson(raw, Seen) ?? NONE_SEEN;
}

export function useSeenVersions(): SeenVersions {
  const raw = useStoredPreference(SEEN_KEY, (value) => value, "{}");
  return useMemo(() => parseSeen(raw), [raw]);
}

export function markSeen(
  seen: SeenVersions,
  artifactId: string,
  version: number,
): void {
  if (seen[artifactId] === version) return;
  writeStoredPreference(
    SEEN_KEY,
    JSON.stringify({ ...seen, [artifactId]: version }),
  );
}
