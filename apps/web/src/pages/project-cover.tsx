/**
 * A project tile's cover: the first page of the design the person chose, or of the first concept
 * filed before a choice, as a still picture; a project with no mockup keeps its pattern. The
 * mockup is read only once the tile is on screen, so a long list does not read every design.
 */
import { useQuery } from "@tanstack/react-query";
import type { ProjectArtifact } from "@corbits-builder/client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { listProjectArtifacts, readArtifact } from "../api/artifacts.ts";
import { keys } from "../queries/keys.ts";
import { firstPage, parseBundle } from "./workspace/design-preview.tsx";
import { GuiFrame } from "./workspace/gui-frame.tsx";

const COVER_STALE_MS = 5 * 60_000;
// A tile a screen's height away starts reading, so it is there by the time it scrolls in.
const AHEAD = "100%";

/** The mockup a tile shows: the design the person chose, else the first concept filed, else none. */
export function coverArtifact(
  artifacts: readonly ProjectArtifact[],
): ProjectArtifact | null {
  const chosen = artifacts.find((item) => item.kind === "design");
  if (chosen !== undefined) return chosen;
  const concept = artifacts.find((item) => item.kind === "design_option");
  return concept === undefined ? null : concept;
}

async function readCoverPage(projectId: string): Promise<string | null> {
  const { artifacts } = await listProjectArtifacts(projectId);
  const pick = coverArtifact(artifacts);
  if (pick === null) return null;
  const filed = await readArtifact(projectId, pick.artifactId, pick.version);
  const files = parseBundle(filed.content);
  return files === null ? null : firstPage(files);
}

/** True once the element has come within a screen of the viewport, and from then on. */
function useNearView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: AHEAD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  return near;
}

export function ProjectCover({
  projectId,
  pattern,
  style,
  mockup,
}: {
  projectId: string;
  pattern: string;
  style: CSSProperties;
  /** Whether to show the mockup at all; a list's small swatch shows the pattern only. */
  mockup: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearView(ref);
  const cover = useQuery({
    queryKey: keys.projectCover.of(projectId),
    queryFn: () => readCoverPage(projectId),
    enabled: mockup && near,
    staleTime: COVER_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const html = mockup && cover.data !== undefined ? cover.data : null;
  return (
    // A still picture: inert, so it neither takes focus nor eats the click that opens the project.
    <span
      ref={ref}
      className="library-cover"
      data-pattern={pattern}
      data-mockup={html === null ? undefined : ""}
      style={style}
      aria-hidden="true"
      inert
    >
      {html === null ? null : <GuiFrame html={html} scripts />}
    </span>
  );
}
