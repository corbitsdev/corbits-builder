/**
 * Where the project stands and the person's one next step, as the hub derives them from native
 * state. The prompt box's placeholder reads it.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { readProjectNextStep } from "../../api/activity.ts";
import { keys } from "../../queries/keys.ts";

const POLL_MS = 5_000;

export function projectNextStepQuery(projectId: string) {
  return queryOptions({
    queryKey: keys.projectNextStep.of(projectId),
    queryFn: ({ signal }) => readProjectNextStep(projectId, signal),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  });
}

export function useProjectNextStep(projectId: string, enabled = true) {
  return useQuery({ ...projectNextStepQuery(projectId), enabled });
}
