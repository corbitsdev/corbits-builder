import { sql, type SQLWrapper } from "drizzle-orm";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import { catalog } from "../plugins/catalog.ts";

function stepRoles(step: unknown): WorkflowRole[] {
  if (typeof step !== "object" || step === null || !("agent" in step))
    return [];
  const agent = step.agent;
  if (typeof agent !== "object" || agent === null || !("tags" in agent))
    return [];
  const tags = agent.tags;
  if (typeof tags !== "object" || tags === null) return [];
  return Object.entries(tags)
    .filter(
      ([tag, value]) =>
        typeof value === "string" &&
        tag.endsWith(".version") &&
        catalog.roles.has(tag.slice(0, -8)),
    )
    .map(([tag]) => tag.slice(0, -8));
}

export function workflowStep(
  bundle: unknown,
): { stepId: string; role: WorkflowRole } | undefined {
  if (typeof bundle !== "object" || bundle === null) return undefined;
  const steps = (bundle as { projection?: { steps?: unknown } }).projection
    ?.steps;
  if (typeof steps !== "object" || steps === null) return undefined;
  const tagged = Object.entries(steps).flatMap(([stepId, step]) =>
    stepRoles(step).map((role) => ({ stepId, role })),
  );
  return tagged.length === 1 ? tagged[0] : undefined;
}

/** The same rule in SQL, so a frozen bundle is read where it is stored. */
export function workflowRoleSql(bundle: SQLWrapper) {
  const tags = Array.from(catalog.roles.keys(), (name) => `${name}.version`);
  return sql<WorkflowRole | null>`(select case when count(*) = 1 then min(left(role_tag.name, -8)) end from jsonb_path_query(${bundle}, '$.projection.steps.*.agent.tags') as role_step(tags), jsonb_each(role_step.tags) as role_tag(name, value) where role_tag.name in ${tags} and jsonb_typeof(role_tag.value) = 'string')`;
}

export function spawnedWorkflowStep(
  bundle: unknown,
): { stepId: string; role: WorkflowRole } | undefined {
  const step = workflowStep(bundle);
  return step && step.role !== "coordinator"
    ? { stepId: step.stepId, role: step.role }
    : undefined;
}

export function spawnedWorkflowRole(bundle: unknown): WorkflowRole | undefined {
  return spawnedWorkflowStep(bundle)?.role;
}
