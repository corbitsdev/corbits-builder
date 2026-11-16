/**
 * Where the project stands and the person's one next step, as the hub derives them from native
 * state, and whether the person's preference turns the line on.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ProjectNextAction } from "@corbits-builder/schemas/project-status";
import { readProjectNextStep } from "../../api/activity.ts";
import { usePreference } from "../../queries/preferences.ts";
import { keys } from "../../queries/keys.ts";
import { wording } from "../../config.ts";
import type { NextStepLineViewProps } from "./next-step.view.tsx";

const POLL_MS = 5_000;
// Mirrors the preference's id in apps/hub/src/config/preferences.ts.
const NEXT_STEP_LINE = "next_step_line";
const text = wording.nextStep;

export type NextStepLineProps = {
  projectId: string;
  /** The workspace's real controls; a step whose control is absent here shows no button. */
  actions: Partial<Record<ProjectNextAction, () => void>>;
};

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

/** The line to show, or null while the preference is off or the hub has not said where things stand. */
export function useNextStepLine({
  projectId,
  actions,
}: NextStepLineProps): NextStepLineViewProps | null {
  const on = usePreference(NEXT_STEP_LINE) === "yes";
  const status = useProjectNextStep(projectId, on);
  if (!on || status.data === undefined) return null;
  const { working, now, next } = status.data;
  const run = next.action === undefined ? undefined : actions[next.action];
  return {
    busy: working.some((item) => item.state === "working"),
    now,
    next: next.text,
    action:
      next.action === undefined || run === undefined
        ? null
        : { label: text.action[next.action], onSelect: run },
  };
}
