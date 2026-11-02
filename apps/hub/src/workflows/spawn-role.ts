import { sql, type SQLWrapper } from "drizzle-orm";
import type {
  SpawnedRole,
  WorkflowRole,
} from "@corbits-builder/schemas/installed-workflows";

// A workflow's role is its one step carrying a role's version tag; untagged steps such as the
// blocked notice do not count. A step's role is its first tag here, in this order.
const ROLE_TAGS: readonly (readonly [tag: string, role: WorkflowRole])[] = [
  ["writer.version", "writer"],
  ["reviewer.version", "reviewer"],
  ["coder.version", "coder"],
  ["designer.version", "designer"],
  ["presenter.version", "presenter"],
  ["coordinator.version", "coordinator"],
];

function stepRole(step: unknown): WorkflowRole | undefined {
  if (typeof step !== "object" || step === null) return undefined;
  const tags = (step as { agent?: { tags?: unknown } }).agent?.tags;
  if (typeof tags !== "object" || tags === null) return undefined;
  const record = tags as Record<string, unknown>;
  return ROLE_TAGS.find(([tag]) => typeof record[tag] === "string")?.[1];
}

function workflowStep(
  bundle: unknown,
): { stepId: string; role: WorkflowRole } | undefined {
  if (typeof bundle !== "object" || bundle === null) return undefined;
  const steps = (bundle as { projection?: { steps?: unknown } }).projection
    ?.steps;
  if (typeof steps !== "object" || steps === null) return undefined;
  const tagged = Object.entries(steps).flatMap(([stepId, step]) => {
    const role = stepRole(step);
    return role ? [{ stepId, role }] : [];
  });
  return tagged.length === 1 ? tagged[0] : undefined;
}

/** The same rule in SQL, so a frozen bundle is read where it is stored. */
export function workflowRoleSql(bundle: SQLWrapper) {
  const cases = sql.join(
    ROLE_TAGS.map(
      ([tag, role]) =>
        sql`when jsonb_typeof(role_step.tags -> ${tag}::text) = 'string' then ${role}::text`,
    ),
    sql` `,
  );
  return sql<WorkflowRole | null>`(select case when count(*) = 1 then min(role_steps.role) end from (select case ${cases} end as role from jsonb_path_query(${bundle}, '$.projection.steps.*.agent.tags') as role_step(tags)) as role_steps where role_steps.role is not null)`;
}

export function spawnedWorkflowStep(
  bundle: unknown,
): { stepId: string; role: SpawnedRole } | undefined {
  const step = workflowStep(bundle);
  return step && step.role !== "coordinator"
    ? { stepId: step.stepId, role: step.role }
    : undefined;
}

export function spawnedWorkflowRole(bundle: unknown): SpawnedRole | undefined {
  return spawnedWorkflowStep(bundle)?.role;
}
