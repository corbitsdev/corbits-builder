/**
 * Who is at work right now, as the hub reads it from native state: the runs
 * Interchange reports mid-turn and the tool calls their own inference events
 * carried.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  readProjectActivity,
  readProjectRunStates,
} from "../../api/activity.ts";
import { keys } from "../../queries/keys.ts";

const POLL_MS = 10_000;
const BUSY_POLL_MS = 3_000;
const RUN_STATE_POLL_MS = 5_000;

export function projectActivityQuery(projectId: string) {
  return queryOptions({
    queryKey: keys.projectActivity.of(projectId),
    queryFn: ({ signal }) => readProjectActivity(projectId, signal),
    // While anyone is mid-turn, a hand-off and each step read sooner.
    refetchInterval: (query) => {
      const agents = query.state.data?.agents;
      return agents !== undefined && agents.length > 0 ? BUSY_POLL_MS : POLL_MS;
    },
    refetchOnWindowFocus: false,
  });
}

export function useProjectActivity(projectId: string) {
  return useQuery(projectActivityQuery(projectId));
}

/**
 * Each live run's state by its latest committed event, polled while any run is live. A run that
 * parks on an approval raises no room event, so this is how the page learns the person's turn came.
 */
export function projectRunStatesQuery(projectId: string) {
  return queryOptions({
    queryKey: keys.projectRunStates.of(projectId),
    queryFn: ({ signal }) => readProjectRunStates(projectId, signal),
    refetchInterval: (query) =>
      query.state.data !== undefined && query.state.data.runs.length > 0
        ? RUN_STATE_POLL_MS
        : POLL_MS,
    refetchOnWindowFocus: false,
  });
}

export function useProjectRunStates(projectId: string) {
  return useQuery(projectRunStatesQuery(projectId));
}

/** The runs held on an approval, as one string a React effect can depend on. */
export function heldOnApproval(
  states: { runs: readonly { runId: string; state: string }[] } | undefined,
): string {
  if (states === undefined) return "";
  return states.runs
    .filter((run) => run.state === "approval")
    .map((run) => run.runId)
    .sort()
    .join(",");
}

/** The roles with a run mid-turn right now, from the hub's native activity read; undefined until it is read. */
export function useRolesAtWork(
  projectId: string,
): ReadonlySet<string> | undefined {
  const agents = useProjectActivity(projectId).data?.agents;
  return agents === undefined
    ? undefined
    : new Set(agents.map((agent) => agent.role));
}
