import { sql, type SQLWrapper } from "drizzle-orm";
import { ROLE_TAG, type Role } from "@corbits-builder/plugin";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
import { CATALOG } from "../plugins/catalog.ts";
import { COORDINATOR } from "./coordinator-role.ts";

// The coordinator's agent is tagged with its package's version, which the coordinator registry
// reads; every specialist's agent is tagged with the name of the role it plays. Runs stored before
// that tag carry only "<role>.version", so a step without it plays the role a version tag names.
const COORDINATOR_TAG = "coordinator.version";
const VERSION_TAG = ".version";

type Roles = Pick<Catalog, "role" | "roles">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// A step's role: the coordinator, or a role an installed plugin declares; untagged steps such as
// the blocked notice, and roles no installed plugin declares, do not count.
function stepRole(step: unknown, roles: Roles): string | undefined {
  if (!isRecord(step) || !isRecord(step["agent"])) return undefined;
  const tags = step["agent"]["tags"];
  if (!isRecord(tags)) return undefined;
  const named = tags[ROLE_TAG];
  if (typeof named === "string")
    return roles.role(named) === undefined ? undefined : named;
  if (typeof tags[COORDINATOR_TAG] === "string") return COORDINATOR.name;
  return Object.keys(tags)
    .filter((tag) => tag.endsWith(VERSION_TAG) && typeof tags[tag] === "string")
    .map((tag) => tag.slice(0, -VERSION_TAG.length))
    .find((name) => roles.role(name) !== undefined);
}

// A workflow's role is its one step that plays one.
function workflowStep(
  bundle: unknown,
  roles: Roles,
): { stepId: string; role: string } | undefined {
  if (!isRecord(bundle) || !isRecord(bundle["projection"])) return undefined;
  const steps = bundle["projection"]["steps"];
  if (!isRecord(steps)) return undefined;
  const tagged = Object.entries(steps).flatMap(([stepId, step]) => {
    const role = stepRole(step, roles);
    return role ? [{ stepId, role }] : [];
  });
  return tagged.length === 1 ? tagged[0] : undefined;
}

/** The same rule in SQL, so a frozen bundle is read where it is stored: the name of its role. */
export function workflowRoleSql(bundle: SQLWrapper) {
  const names = sql.join(
    CATALOG.roles.map(({ name }) => sql`${name}::text`),
    sql`, `,
  );
  const installed =
    CATALOG.roles.length === 0
      ? sql`false`
      : sql`role_step.tags ->> ${ROLE_TAG}::text in (${names})`;
  // The role a stored run's "<role>.version" tag names, for a run from before the role tag.
  const versioned =
    CATALOG.roles.length === 0
      ? sql`null`
      : sql`(select left(tag, -length(${VERSION_TAG}::text)) from jsonb_each(role_step.tags) as versions(tag, value) where jsonb_typeof(value) = 'string' and right(tag, length(${VERSION_TAG}::text)) = ${VERSION_TAG}::text and left(tag, -length(${VERSION_TAG}::text)) in (${names}) limit 1)`;
  return sql<
    string | null
  >`(select case when count(*) = 1 then min(role_steps.role) end from (select case when jsonb_typeof(role_step.tags -> ${ROLE_TAG}::text) = 'string' then case when ${installed} then role_step.tags ->> ${ROLE_TAG}::text end when jsonb_typeof(role_step.tags -> ${COORDINATOR_TAG}::text) = 'string' then ${COORDINATOR.name}::text else ${versioned} end as role from jsonb_path_query(${bundle}, '$.projection.steps.*.agent.tags') as role_step(tags)) as role_steps where role_steps.role is not null)`;
}

/** Whether a frozen bundle's role is one of the installed roles that match, in SQL. */
export function workflowRoleMatchesSql(
  bundle: SQLWrapper,
  matches: (role: Role) => boolean,
) {
  const names = CATALOG.roles
    .filter(matches)
    .map(({ name }) => sql`${name}::text`);
  return names.length === 0
    ? sql<boolean>`false`
    : sql<boolean>`${workflowRoleSql(bundle)} in (${sql.join(names, sql`, `)})`;
}

/** The step of a specialist's run and the role it plays, of the given roles. */
export function roleStep(
  bundle: unknown,
  roles: Roles,
): { stepId: string; role: Role } | undefined {
  const step = workflowStep(bundle, roles);
  const role = step && roles.role(step.role);
  return step && role ? { stepId: step.stepId, role } : undefined;
}

/** The step of a specialist's run and the installed role it plays. */
export const spawnedWorkflowStep = (bundle: unknown) =>
  roleStep(bundle, CATALOG);

/** The installed role a specialist's run plays; undefined for the coordinator's and any other. */
export function spawnedWorkflowRole(bundle: unknown): Role | undefined {
  return spawnedWorkflowStep(bundle)?.role;
}
