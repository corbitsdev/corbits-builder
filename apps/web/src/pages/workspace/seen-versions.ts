/** The version of each document this viewer last opened, kept in this browser. */
import { useMemo } from "react";
import {
  useStoredPreference,
  writeStoredPreference,
} from "../../stored-preference.ts";

const SEEN_KEY = "builder-seen-document-versions";

export type SeenVersions = Readonly<Record<string, number>>;

function parseSeen(raw: string): SeenVersions {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as SeenVersions)
      : {};
  } catch {
    return {};
  }
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
