import { expect, test } from "bun:test";
import { authorizeAction } from "@intx/authz";
import type { GrantRequirement } from "@intx/types/grants";
import { projectResource } from "../projects/errors.ts";
import {
  composeSpecialistProjectRead,
  delegatableSpecialistGrants,
} from "./specialist-project-grant.ts";

const assigned = "sb-ly2mtlm1x";
const unrelated = "sb-otherproject1";
const requirements: GrantRequirement[] = [
  { resource: "sb-project:*", action: "read", source: "invoker" },
  { resource: "sb-project:*", action: "manage", source: "invoker" },
  { resource: "sb-source:problem_brief-*", action: "read", source: "invoker" },
  {
    resource: "sb-artifact:solution_constraints-*:solution_constraints",
    action: "write",
    source: "invoker",
  },
  { resource: "*", action: "*", source: "invoker" },
];

test("mail-triggered specialist reads only its assigned project", async () => {
  const composed = composeSpecialistProjectRead({
    requirements,
    projectId: assigned,
  });
  const grants = delegatableSpecialistGrants(composed);
  expect(
    grants.filter((grant) => grant.resource.startsWith("sb-project:")),
  ).toEqual([{ resource: projectResource(assigned), action: "read" }]);
  expect(
    grants.some(
      (grant) =>
        grant.resource === "*" ||
        grant.resource === "sb-project:*" ||
        grant.action === "manage",
    ),
  ).toBe(false);
  const rules = grants.map((grant, index) => ({
    id: "grant-" + index,
    resource: grant.resource,
    action: grant.action,
    effect: "allow" as const,
    origin: "system" as const,
    conditions: null,
    expiresAt: null,
    roleId: null,
    principalId: "prn_specialist",
  }));
  const read = { conditions: "pessimistic" as const };
  expect(
    await authorizeAction(rules, projectResource(assigned), "read", read),
  ).toEqual({
    ok: true,
  });
  expect(
    await authorizeAction(rules, projectResource(unrelated), "read", read),
  ).toEqual({
    ok: false,
    reason: "no_matching_grant",
  });
  expect(
    await authorizeAction(rules, projectResource(assigned), "manage", read),
  ).toEqual({
    ok: false,
    reason: "no_matching_grant",
  });
});
