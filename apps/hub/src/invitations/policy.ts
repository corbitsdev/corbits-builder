import { evaluateGrants, matchPattern, type GrantRule } from "@intx/authz";
import { ProjectError } from "../projects/errors.ts";

export function invitationDeadline(value: string, now: Date): Date {
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value ||
    date <= now
  )
    throw new ProjectError(400, "invalid_invitation_deadline");
  return date;
}

export function invitationState(
  row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): "pending" | "activated" | "expired" | "revoked" {
  if (row.revokedAt) return "revoked";
  if (row.acceptedAt) return "activated";
  return row.expiresAt <= now ? "expired" : "pending";
}

// Evaluating a wildcard as though it were one resource misses narrower denies,
// so a wildcard role is delegable only when one unconditioned issuer allow
// covers its whole pattern and no issuer deny or ask could match inside it.
// Conditioned and invoker denies or asks count, as in pessimistic evaluation.
export async function assertInvitationDelegation(
  issuerGrants: GrantRule[],
  roleGrants: Pick<GrantRule, "resource" | "action" | "effect">[],
) {
  const now = new Date();
  const delegatable = issuerGrants.filter(
    (rule) =>
      (rule.origin !== "invoker" || rule.effect !== "allow") &&
      (rule.expiresAt === null || rule.expiresAt >= now),
  );
  for (const rule of roleGrants) {
    if (rule.effect === "deny") continue;
    if (rule.resource.includes("*") || rule.action.includes("*")) {
      if (!wildcardDelegable(delegatable, rule))
        throw new ProjectError(403, "invitation_delegation_refused");
      continue;
    }
    const result = await evaluateGrants(
      delegatable,
      rule.resource,
      rule.action,
      {
        conditions: "pessimistic",
      },
    );
    if (result.effect !== "allow")
      throw new ProjectError(403, "invitation_delegation_refused");
  }
}

function wildcardDelegable(
  delegatable: GrantRule[],
  rule: Pick<GrantRule, "resource" | "action">,
) {
  const covered = delegatable.some(
    (grant) =>
      grant.effect === "allow" &&
      !(grant.conditions && Object.keys(grant.conditions).length > 0) &&
      patternCovers(grant.resource, rule.resource) &&
      patternCovers(grant.action, rule.action),
  );
  const restricted = delegatable.some(
    (grant) =>
      grant.effect !== "allow" &&
      patternsMayOverlap(grant.resource, rule.resource) &&
      patternsMayOverlap(grant.action, rule.action),
  );
  return covered && !restricted;
}

// Covers only when every string the inner pattern matches is matched by the outer.
function patternCovers(outer: string, inner: string) {
  if (outer === "*" || outer === inner) return true;
  const star = outer.indexOf("*");
  return star === outer.length - 1 && inner.startsWith(outer.slice(0, star));
}

// Two globs can only be disjoint when their literal prefixes or suffixes conflict.
function patternsMayOverlap(a: string, b: string) {
  if (!a.includes("*") || !b.includes("*"))
    return matchPattern(a, b) || matchPattern(b, a);
  const prefix = (p: string) => p.slice(0, p.indexOf("*"));
  const suffix = (p: string) => p.slice(p.lastIndexOf("*") + 1);
  const compatible = (
    x: string,
    y: string,
    same: (l: string, s: string) => boolean,
  ) => (x.length >= y.length ? same(x, y) : same(y, x));
  return (
    compatible(prefix(a), prefix(b), (l, s) => l.startsWith(s)) &&
    compatible(suffix(a), suffix(b), (l, s) => l.endsWith(s))
  );
}
