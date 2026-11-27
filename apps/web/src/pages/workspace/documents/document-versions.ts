/** Version metadata for the strip. Bytes are a separate read. */
export type RetainedVersion = {
  version: number;
  title: string;
  mediaType: string;
};

/**
 * The next older retained version, if the index or the already loaded
 * predecessor names one. An empty index is not a claim that this is v1.
 */
export function predecessorOf(
  versions: readonly { version: number }[] | undefined,
  viewing: number,
  headVersion: number,
  beforeVersion: number | null,
): number | null {
  if (versions !== undefined && versions.length > 0) {
    const ordered = [...versions].sort(
      (left, right) => left.version - right.version,
    );
    const index = ordered.findIndex((item) => item.version === viewing);
    if (index > 0) return ordered[index - 1]?.version ?? null;
    return null;
  }
  if (viewing === headVersion) return beforeVersion;
  return null;
}
