import { expect, test } from "bun:test";
import { evaluateGrants, type GrantRule } from "@intx/authz";
import {
  assertInvitationDelegation,
  invitationDeadline,
  invitationState,
} from "./policy.ts";

const rule = (overrides: Partial<GrantRule> = {}): GrantRule => ({
  id: "issuer-grant",
  principalId: "issuer",
  roleId: null,
  resource: "sb-source:shared",
  action: "read",
  effect: "allow",
  origin: "creator",
  conditions: null,
  expiresAt: null,
  ...overrides,
});
const selected = [
  { resource: "sb-source:shared", action: "read", effect: "allow" as const },
];

test("invitation delegation refuses a wildcard role a native wildcard query would pass over a narrower deny", async () => {
  const issuer = [
    rule({ resource: "sb-source:*" }),
    rule({ id: "private-deny", resource: "sb-source:private", effect: "deny" }),
  ];
  expect(
    (
      await evaluateGrants(issuer, "sb-source:*", "read", {
        conditions: "pessimistic",
      })
    ).effect,
  ).toBe("allow");
  expect(
    (
      await evaluateGrants(issuer, "sb-source:private", "read", {
        conditions: "pessimistic",
      })
    ).effect,
  ).toBe("deny");
  for (const role of [
    [{ resource: "sb-source:*", action: "read", effect: "allow" as const }],
    [{ resource: "sb-source:shared", action: "*", effect: "allow" as const }],
    [{ resource: "sb-source:*", action: "read", effect: "ask" as const }],
    [{ resource: "sb-source:p*", action: "read", effect: "allow" as const }],
    [{ resource: "*", action: "read", effect: "allow" as const }],
  ])
    await expect(assertInvitationDelegation(issuer, role)).rejects.toThrow(
      "invitation_delegation_refused",
    );
  await assertInvitationDelegation(issuer, selected);
  await assertInvitationDelegation(issuer, [
    { resource: "sb-source:shared-*", action: "read", effect: "allow" },
  ]);
  await expect(
    assertInvitationDelegation(issuer, [
      { ...selected[0]!, resource: "sb-source:private" },
    ]),
  ).rejects.toThrow("invitation_delegation_refused");
});

test("an owner invites admins and members, and an admin cannot invite an owner", async () => {
  const owner = [rule({ resource: "*", action: "*" })];
  const admin = ["read", "create", "manage"].map((action) =>
    rule({ id: `admin-${action}`, resource: "*", action }),
  );
  const ownerRole = [{ resource: "*", action: "*", effect: "allow" as const }];
  const adminRole = admin.map(({ resource, action }) => ({
    resource,
    action,
    effect: "allow" as const,
  }));
  const memberRole = [
    { resource: "*", action: "read", effect: "allow" as const },
  ];
  await assertInvitationDelegation(owner, adminRole);
  await assertInvitationDelegation(owner, memberRole);
  await assertInvitationDelegation(owner, ownerRole);
  await assertInvitationDelegation(admin, memberRole);
  await expect(assertInvitationDelegation(admin, ownerRole)).rejects.toThrow(
    "invitation_delegation_refused",
  );
  for (const restriction of [
    rule({
      id: "deny",
      resource: "sb-project:secret",
      action: "read",
      effect: "deny",
    }),
    rule({ id: "ask", resource: "sb-project:*", action: "*", effect: "ask" }),
    rule({
      id: "cond",
      resource: "*",
      action: "read",
      effect: "deny",
      conditions: { x: 1 },
    }),
    rule({
      id: "invoker",
      resource: "sb-*",
      action: "read",
      effect: "deny",
      origin: "invoker",
    }),
  ])
    await expect(
      assertInvitationDelegation([...owner, restriction], memberRole),
    ).rejects.toThrow("invitation_delegation_refused");
  for (const unusable of [
    rule({ resource: "*", action: "*", conditions: { x: 1 } }),
    rule({ resource: "*", action: "*", origin: "invoker" }),
    rule({ resource: "*", action: "*", expiresAt: new Date(0) }),
  ])
    await expect(
      assertInvitationDelegation([unusable], memberRole),
    ).rejects.toThrow("invitation_delegation_refused");
  await assertInvitationDelegation(
    [
      ...owner,
      rule({ id: "deny", resource: "*", action: "delete", effect: "deny" }),
    ],
    memberRole,
  );
});

test("invitation delegation cannot launder ask, conditioned or invoker-only authority", async () => {
  for (const issuer of [
    [],
    [rule({ effect: "ask" })],
    [rule({ conditions: { caller: "allowed-only-in-a-request" } })],
    [rule({ origin: "invoker" })],
    [rule({ expiresAt: new Date(0) })],
    [rule(), rule({ id: "ask", effect: "ask", conditions: { unknown: true } })],
    [
      rule(),
      rule({ id: "deny", effect: "deny", conditions: { unknown: true } }),
    ],
    [rule(), rule({ id: "invoker-deny", origin: "invoker", effect: "deny" })],
    [rule(), rule({ id: "invoker-ask", origin: "invoker", effect: "ask" })],
  ])
    for (const effect of ["allow", "ask"] as const)
      await expect(
        assertInvitationDelegation(issuer, [{ ...selected[0]!, effect }]),
      ).rejects.toThrow("invitation_delegation_refused");
  await assertInvitationDelegation([rule()], selected);
  await assertInvitationDelegation(
    [],
    [{ resource: "*", action: "*", effect: "deny" }],
  );
});

test("invitation deadline is an explicit future canonical UTC instant", () => {
  const now = new Date("2026-10-23T08:00:00.000Z");
  const future = "2026-10-23T08:00:00.001Z";
  expect(invitationDeadline(future, now).toISOString()).toBe(future);
  for (const value of [
    now.toISOString(),
    "2026-10-23T07:59:59.999Z",
    "2026-10-23",
    "2026-10-23T09:00:00Z",
    "2026-10-23T09:00:00.000+00:00",
    "2026-02-30T09:00:00.000Z",
    "not-a-date",
    "",
  ])
    expect(() => invitationDeadline(value, now)).toThrow(
      "invalid_invitation_deadline",
    );
});

test("invitation expiry cannot reverse an accepted or revoked terminal state", () => {
  const deadline = new Date("2026-10-23T08:00:00.000Z");
  const row = { acceptedAt: null, revokedAt: null, expiresAt: deadline };
  expect(invitationState(row, new Date(deadline.getTime() - 1))).toBe(
    "pending",
  );
  expect(invitationState(row, deadline)).toBe("expired");
  expect(invitationState(row, new Date(deadline.getTime() + 1))).toBe(
    "expired",
  );
  expect(invitationState({ ...row, acceptedAt: deadline }, deadline)).toBe(
    "activated",
  );
  expect(invitationState({ ...row, revokedAt: deadline }, deadline)).toBe(
    "revoked",
  );
});
