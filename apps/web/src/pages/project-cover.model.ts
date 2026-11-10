/**
 * Reading project tiles' covers: the first page of the design the person
 * chose, or of the first concept filed before a choice. A mockup is read only
 * once its tile has come near the screen, so a long list does not read every
 * design.
 */
import { useQueries } from "@tanstack/react-query";
import type { ProjectArtifact } from "@corbits-builder/client";
import { useState } from "react";
import { listProjectArtifacts, readArtifact } from "../api/artifacts.ts";
import { keys } from "../queries/keys.ts";
import { firstPage, parseBundle } from "./workspace/design-bundle.ts";

const COVER_STALE_MS = 5 * 60_000;

/** The mockup a tile shows: the design the person chose, else the first concept filed, else none. */
export function coverArtifact(
  artifacts: readonly ProjectArtifact[],
): ProjectArtifact | null {
  const chosen = artifacts.find((item) => item.kind === "design");
  if (chosen !== undefined) return chosen;
  const concept = artifacts.find((item) => item.kind === "design_option");
  return concept === undefined ? null : concept;
}

/** The bundle's first page as the tile shows it, or null for a bundle with no page to show yet. */
export function coverPage(
  files: Readonly<Record<string, string>>,
): string | null {
  const page = firstPage(files);
  return page.trim() === "" ? null : page;
}

async function readCoverPage(projectId: string): Promise<string | null> {
  const { artifacts } = await listProjectArtifacts(projectId);
  const pick = coverArtifact(artifacts);
  if (pick === null) return null;
  const filed = await readArtifact(projectId, pick.artifactId, pick.version);
  const files = parseBundle(filed.content);
  return files === null ? null : coverPage(files);
}

/**
 * The cover page of each project, in the order given: null until its tile has come near the
 * screen and its mockup is read, and for a project with none. `wanted` is false where the tiles
 * show their pattern only, and then nothing is read.
 */
export function useCoverPages(
  projectIds: readonly string[],
  wanted: boolean,
): { pages: (string | null)[]; onNear: (projectId: string) => void } {
  const [near, setNear] = useState<ReadonlySet<string>>(new Set());
  const covers = useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: keys.projectCover.of(projectId),
      queryFn: () => readCoverPage(projectId),
      enabled: wanted && near.has(projectId),
      staleTime: COVER_STALE_MS,
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });
  return {
    pages: covers.map((cover) =>
      wanted && cover.data !== undefined ? cover.data : null,
    ),
    onNear: (projectId) =>
      setNear((current) => new Set(current).add(projectId)),
  };
}
