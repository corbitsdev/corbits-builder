/** The live designer's unfiled mockup, read from the hub until a design is filed. */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { keys } from "../../queries/keys.ts";
import { readProjectActivity } from "../../api/activity.ts";
import { readDesignDraft } from "../../api/artifacts.ts";
import type { DesignFiles } from "./design-bundle.ts";
import { roleOf } from "./roles.ts";

// Whether a run's role drafts the design.
const designs = (role: string) => roleOf(role)?.designs === true;

const DRAFT_REFRESH_MS = 12_000;
const DESIGNER_ACTIVITY_MS = 2_000;
const FILE_WRITES = new Set(["write_file", "edit_file"]);

/**
 * Whether the live mockup should stop. A filed design stops it, as does a loaded snapshot whose
 * designer is not drafting the whole mockup. A missing snapshot does not: an empty stand-in would
 * hide a designer the room has not loaded yet.
 */
export function designDraftFiled(
  hasFiledDesign: boolean,
  inFlight:
    | readonly { readonly role: string; readonly concept?: string }[]
    | undefined,
): boolean {
  if (hasFiledDesign) return true;
  if (inFlight === undefined) return false;
  return !inFlight.some(
    (run) => designs(run.role) && run.concept === undefined,
  );
}

/**
 * The live designer's unfiled mockup until a design is filed: read again as soon as the activity
 * read shows the designer finish a file write, and on a slower poll in case a write is missed.
 * With a concept, that concept's designer until its option is filed.
 */
export function useDesignDraft(
  projectId: string,
  designFiled: boolean,
  concept?: string,
): DesignFiles | null {
  const draft = useQuery({
    queryKey: keys.designDraft.of(projectId, concept),
    queryFn: () => readDesignDraft(projectId, concept),
    enabled: !designFiled,
    refetchInterval: DRAFT_REFRESH_MS,
    retry: false,
  });
  const activity = useQuery({
    queryKey: keys.projectActivity.of(projectId),
    queryFn: ({ signal }) => readProjectActivity(projectId, signal),
    enabled: !designFiled,
    refetchInterval: (query) =>
      query.state.data?.agents.some((agent) => designs(agent.role))
        ? DESIGNER_ACTIVITY_MS
        : DRAFT_REFRESH_MS,
    refetchOnWindowFocus: false,
  });
  const lastWrite = activity.data?.agents
    .filter((agent) => designs(agent.role))
    .flatMap((agent) => agent.tools)
    .filter((tool) => FILE_WRITES.has(tool.name) && !tool.running)
    .map((tool) => `${tool.at} ${tool.subject ?? ""}`)
    .sort()
    .at(-1);
  const { refetch } = draft;
  useEffect(() => {
    if (lastWrite !== undefined) void refetch();
  }, [lastWrite, refetch]);
  return designFiled ? null : (draft.data ?? null);
}
