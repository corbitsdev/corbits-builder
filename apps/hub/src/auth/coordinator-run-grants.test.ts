import { expect, test } from "bun:test";
import {
  authorizeAction,
  evaluateMailAdmission,
  mailAcceptResource,
} from "@intx/authz";
import { DEPLOY_TOOLS } from "../projects/deploy-tools.ts";
import {
  planCoordinatorSpecialistGrants,
  type CoordinatorRunGrant,
} from "./coordinator-run-grants.ts";

const coordinator = "prn_045270a9b4fdcf2c8ee568207724d404";
const specialist = "run_8784b3aced3363817ce483e5377ea22c";
const unrelated = "run_4b0dca39e228e2e3eefbf85227bb7fef";
const consumer = "tool:" + DEPLOY_TOOLS;
const read = {
  conditions: "pessimistic" as const,
  consumer,
};

function rule(grant: CoordinatorRunGrant) {
  return {
    ...grant,
    conditions: null,
    expiresAt: null,
    roleId: null,
  };
}

test("exact specialist read is denied before the bound coordinator grant and unrelated runs stay denied", async () => {
  const before = await authorizeAction(
    [],
    "workflow-run:" + specialist,
    "read",
    read,
  );
  expect(before).toEqual({ ok: false, reason: "no_matching_grant" });
  const plan = planCoordinatorSpecialistGrants({
    coordinatorPrincipalId: coordinator,
    specialists: [
      {
        runId: specialist,
        sourceAuthorityPrincipalId: "prn_85f51aaefedc012aa1bd5b67f28ccf9d",
        launched: false,
      },
    ],
  });
  expect(
    plan.grants.map(
      (grant) => grant.resource + " " + grant.action + " " + grant.effect,
    ),
  ).toEqual(["workflow-run:" + specialist + " read allow"]);
  expect(
    plan.grants.some(
      (grant) => grant.resource.includes("*") || grant.action !== "read",
    ),
  ).toBe(false);
  expect(plan.retargetRunIds).toEqual([specialist]);
  const grants = plan.grants.map(rule);
  expect(
    await authorizeAction(grants, "workflow-run:" + specialist, "read", read),
  ).toEqual({
    ok: true,
  });
  expect(
    await authorizeAction(grants, "workflow-run:" + unrelated, "read", read),
  ).toEqual({
    ok: false,
    reason: "no_matching_grant",
  });
  expect(
    await authorizeAction(grants, "workflow-run:" + specialist, "manage", read),
  ).toEqual({
    ok: false,
    reason: "no_matching_grant",
  });
  const accept = {
    id: "mail-accept-bound-coordinator",
    resource: mailAcceptResource("principal", coordinator),
    action: "accept" as const,
    effect: "allow" as const,
    origin: "system" as const,
    conditions: null,
    expiresAt: null,
    roleId: null,
    principalId: "prn_specialist_pending",
  };
  expect(
    await evaluateMailAdmission({
      senderCoordinates: [{ coordType: "principal", id: coordinator }],
      recipientGrants: [accept],
    }),
  ).toEqual({ admit: true, effect: "allow" });
  expect(
    await evaluateMailAdmission({
      senderCoordinates: [{ coordType: "principal", id: "prn_unrelated" }],
      recipientGrants: [accept],
    }),
  ).toEqual({ admit: false, effect: null });
});
