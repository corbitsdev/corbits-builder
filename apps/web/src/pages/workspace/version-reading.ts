/**
 * Which retained version of a document is read, and the reads behind it. Choosing a version reads
 * it once and keeps it; comparing reads the one before. Every document in the reading pane reads
 * its versions through this, whatever it is drawn as.
 */
import { useEffect, useRef, useState } from "react";
import type { LoadedDeliverable, ReadVersion } from "./deliverable-block.tsx";
import { predecessorOf } from "./document-versions.ts";

export type VersionReadingInput = {
  /** The room's read of the document: its newest version, the one before and the versions kept. */
  document: LoadedDeliverable;
  /** The comparison with an earlier version is open; the pane keeps this per document. */
  changesOpen: boolean;
  onToggleChanges: () => void;
  onReadVersion?: ((version: number) => Promise<ReadVersion>) | undefined;
  /** The person chose a version to read, which holds this document in the pane. */
  onViewVersion?: (() => void) | undefined;
  /** A specific version asked for from elsewhere, such as a package's pinned source. */
  requestedVersion?: { version: number; seq: number } | undefined;
};

export function useVersionReading({
  document,
  changesOpen,
  onToggleChanges,
  onReadVersion,
  onViewVersion,
  requestedVersion,
}: VersionReadingInput) {
  const [viewing, setViewing] = useState(document.version);
  const [cache, setCache] = useState<Record<number, ReadVersion>>({});
  const [baseline, setBaseline] = useState<number | null>(null);
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const readRef = useRef(onReadVersion);
  readRef.current = onReadVersion;

  const readFor = (version: number): ReadVersion | null => {
    if (cache[version] !== undefined) return cache[version] ?? null;
    if (version === document.version) return document;
    if (document.before?.version === version) return document.before;
    return null;
  };
  const textFor = (version: number): string | null =>
    readFor(version)?.content ?? null;

  const predecessor = predecessorOf(
    document.versions,
    viewing,
    document.version,
    document.before?.version ?? null,
  );
  const compareWith = changesOpen ? (baseline ?? predecessor) : null;

  const fetchVersion = async (version: number): Promise<string> => {
    const known = textFor(version);
    if (known !== null) return known;
    const read = readRef.current;
    if (read === undefined)
      throw new Error("This version is listed, but the room cannot read it.");
    const loaded = await read(version);
    setCache((current) => ({ ...current, [version]: loaded }));
    return loaded.content;
  };

  // Reads a version the room has not loaded, then acts on it; a failed read is the document's error line.
  const withVersion = async (version: number, use: () => void) => {
    setPendingVersion(version);
    setReadError(null);
    try {
      await fetchVersion(version);
      use();
    } catch (cause) {
      setReadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingVersion(null);
    }
  };

  const selectVersion = (version: number) => {
    if (version === viewing) return;
    onViewVersion?.();
    setReadError(null);
    if (textFor(version) !== null) {
      setViewing(version);
      return;
    }
    void withVersion(version, () => setViewing(version));
  };

  const appliedRequestSeq = useRef<number | null>(null);
  useEffect(() => {
    if (
      requestedVersion !== undefined &&
      requestedVersion.seq !== appliedRequestSeq.current
    ) {
      appliedRequestSeq.current = requestedVersion.seq;
      selectVersion(requestedVersion.version);
    }
  }, [requestedVersion]);

  const comparePrevious = () => {
    if (predecessor === null) return;
    void withVersion(predecessor, () => {
      setBaseline(predecessor);
      if (!changesOpen) onToggleChanges();
    });
  };

  const stopComparing = () => {
    setBaseline(null);
    if (changesOpen) onToggleChanges();
  };

  return {
    /** The version on show. */
    viewing,
    /** The version on show, read, or null while it is not. */
    shown: readFor(viewing),
    /** The version on show's text, and the text it is compared with once that is read. */
    afterText: textFor(viewing),
    beforeText: compareWith === null ? null : textFor(compareWith),
    /** The version the one on show is compared with, while the comparison is open. */
    compareWith,
    /** The version before the one on show, which a comparison starts from. */
    predecessor,
    /** A version being read, before it is shown or compared. */
    pendingVersion,
    readError,
    fetchVersion,
    selectVersion,
    comparePrevious,
    stopComparing,
  };
}
