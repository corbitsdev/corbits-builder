import { authorizeAction } from "@intx/authz";
import { createGrantStore, type DB } from "@intx/db";
import { grant, workflowRun, workflowRunLaunchSpec } from "@intx/db/schema";
import { GrantWalkSnapshot } from "@intx/types/grant-snapshot";
import type { GrantRequirement } from "@intx/types/grants";
import { and, eq } from "drizzle-orm";
import { type } from "arktype";
import { projectCoordinator } from "../db/schema.ts";
import { projectResource } from "../projects/errors.ts";

// A packaged specialist declares `sb-project:*` read from its invoker. It gets read
// on exactly the one project its coordinator owns: never the wildcard, manage, or a
// broad admin grant.
export function composeSpecialistProjectRead(args: {
  requirements: readonly GrantRequirement[];
  projectId: string;
}): GrantRequirement[] {
  const exact = projectResource(args.projectId);
  return args.requirements.flatMap((requirement) => {
    if (requirement.resource !== "sb-project:*") return [requirement];
    if (requirement.action !== "read") return [];
    return [{ ...requirement, resource: exact }];
  });
}

export function delegatableSpecialistGrants(
  requirements: readonly GrantRequirement[],
): { resource: string; action: string }[] {
  return requirements.flatMap((requirement) => {
    if (requirement.source !== "invoker") return [];
    if (requirement.effect !== undefined && requirement.effect !== "allow")
      return [];
    if (
      requirement.resource === "*" ||
      requirement.action === "*" ||
      requirement.action === "manage" ||
      requirement.resource === "sb-project:*"
    )
      return [];
    return [{ resource: requirement.resource, action: requirement.action }];
  });
}

function specialistGrantId(
  principalId: string,
  resource: string,
  action: string,
): string {
  const digest = new Bun.CryptoHasher("sha256")
    .update(principalId + "\n" + resource + "\n" + action)
    .digest("hex")
    .slice(0, 40);
  return "spec-grant-" + digest;
}

// Runs before native mail-trigger materialization. Narrows the frozen project
// read and gives the deployer a system-origin copy of each declared invoker
// allow it can actually delegate. Other deployments are left untouched.
export async function prepareMailTriggeredSpecialistGrants(
  db: DB["db"],
  agentAddress: string,
): Promise<void> {
  const [anchor] = await db
    .select({ id: workflowRun.id, tenantId: workflowRun.tenantId })
    .from(workflowRun)
    .where(eq(workflowRun.address, agentAddress))
    .limit(1);
  if (!anchor) return;
  const [launch] = await db
    .select({
      source: workflowRunLaunchSpec.sourceAuthorityPrincipalId,
      snapshot: workflowRunLaunchSpec.grantSnapshot,
    })
    .from(workflowRunLaunchSpec)
    .where(eq(workflowRunLaunchSpec.anchorRunId, anchor.id))
    .limit(1);
  if (!launch?.snapshot) return;
  const parsed = GrantWalkSnapshot(launch.snapshot);
  if (parsed instanceof type.errors) return;
  const declaresProjectRead = parsed.grantRequirements.some(
    (requirement) =>
      requirement.source === "invoker" &&
      requirement.action === "read" &&
      requirement.resource === "sb-project:*",
  );
  if (!declaresProjectRead) return;
  const bindings = await db
    .select({ projectId: projectCoordinator.projectId })
    .from(projectCoordinator)
    .innerJoin(workflowRun, eq(workflowRun.id, projectCoordinator.runId))
    .where(
      and(
        eq(projectCoordinator.active, true),
        eq(workflowRun.tenantId, anchor.tenantId),
        eq(workflowRun.principalId, launch.source),
      ),
    );
  if (bindings.length !== 1) return;
  const projectId = bindings[0]!.projectId;
  const composed = composeSpecialistProjectRead({
    requirements: parsed.grantRequirements,
    projectId,
  });
  const next = GrantWalkSnapshot.assert({
    ...parsed,
    grantRequirements: composed,
  });
  await db
    .update(workflowRunLaunchSpec)
    .set({ grantSnapshot: next })
    .where(eq(workflowRunLaunchSpec.anchorRunId, anchor.id));
  const held = await createGrantStore(db).collectGrants(
    launch.source,
    anchor.tenantId,
  );
  const delegatable = held.filter(
    (item) =>
      item.origin !== "invoker" ||
      item.effect === "deny" ||
      item.effect === "ask",
  );
  const missing: { resource: string; action: string }[] = [];
  for (const requirement of delegatableSpecialistGrants(composed)) {
    const decision = await authorizeAction(
      delegatable,
      requirement.resource,
      requirement.action,
      {
        conditions: "pessimistic",
      },
    );
    if (!decision.ok) missing.push(requirement);
  }
  if (missing.length === 0) return;
  await db
    .insert(grant)
    .values(
      missing.map((requirement) => ({
        id: specialistGrantId(
          launch.source,
          requirement.resource,
          requirement.action,
        ),
        tenantId: anchor.tenantId,
        principalId: launch.source,
        resource: requirement.resource,
        action: requirement.action,
        effect: "allow" as const,
        origin: "system" as const,
      })),
    )
    .onConflictDoNothing();
}
