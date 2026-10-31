/**
 * Document versions filed while the room is open, read from the artifact list
 * the room already polls, never from the model's prose. The newest one is
 * what the reading pane follows.
 */
import { useEffect, useRef, useState } from "react";

export type FiledVersion = {
  readonly kind: string;
  readonly title: string;
  readonly version: number;
};

export function useFiledVersions(input: {
  readonly projectId: string;
  /** The room has its first read; versions before it are history, not news. */
  readonly ready: boolean;
  readonly documents: readonly FiledVersion[];
}): readonly FiledVersion[] {
  const { projectId, ready, documents } = input;
  const seen = useRef<Map<string, number> | null>(null);
  const [filed, setFiled] = useState<readonly FiledVersion[]>([]);

  useEffect(() => {
    seen.current = null;
    setFiled([]);
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    const known = seen.current;
    seen.current = new Map(documents.map((item) => [item.kind, item.version]));
    if (known === null) return;
    const fresh = documents
      .filter((item) => item.version > (known.get(item.kind) ?? 0))
      .map(({ kind, title, version }) => ({ kind, title, version }));
    if (fresh.length > 0) setFiled((current) => [...current, ...fresh]);
  }, [ready, documents]);

  return filed;
}
