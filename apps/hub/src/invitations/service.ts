import { type } from "arktype";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  createGrantStore,
  createPrincipalStore,
  type DB,
  type DBExecutor,
  type PrincipalKeyStore,
} from "@intx/db";
import {
  account,
  grant,
  principal,
  principalRole,
  role,
  user,
} from "@intx/db/schema";
import { canonicalJsonStringify } from "@intx/types/wire-definition-hash";
import { CreateInvitation } from "@corbits-builder/schemas/invitation";
import { invitation } from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  assertInvitationDelegation,
  invitationDeadline,
  invitationState,
} from "./policy.ts";
import type { Actor as BaseActor } from "../lib/actor.ts";

type Actor = BaseActor & { userId: string };
type InvitationRow = typeof invitation.$inferSelect;

async function databaseTime(tx: DBExecutor): Promise<Date> {
  const rows = type({ now: "string" })
    .array()
    .assert(await tx.execute(sql`select clock_timestamp()::text as now`));
  return new Date(rows[0]!.now);
}
function invitationResponse(row: InvitationRow, now: Date) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    roleId: row.roleId,
    invitedBy: row.invitedBy,
    state: invitationState(row, now),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    principalId: row.acceptedPrincipalId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

const sha256Hex = (value: string) =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

export function createInvitationService(db: DB["db"], keys: PrincipalKeyStore) {
  const principals = createPrincipalStore(db, keys);
  const nativeGrants = createGrantStore(db);

  async function issuer(actor: Actor) {
    const allowed = await reportAuthorization(db, actor);
    const [member] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.id, actor.principalId),
          eq(principal.tenantId, actor.tenantId),
          eq(principal.kind, "user"),
          eq(principal.refId, actor.userId),
          eq(principal.status, "active"),
        ),
      );
    if (!member || !(await allowed("principal:*", "create")))
      throw new ProjectError(403, "invitation_management_refused");
    return allowed;
  }
  async function lockIssuer(
    tx: DBExecutor,
    principalId: string,
    tenantId: string,
  ) {
    const [member] = await tx
      .select({ id: principal.id })
      .from(principal)
      .where(
        and(
          eq(principal.id, principalId),
          eq(principal.tenantId, tenantId),
          eq(principal.kind, "user"),
          eq(principal.status, "active"),
        ),
      )
      .for("share");
    if (!member) throw new ProjectError(403, "invitation_delegation_refused");
  }
  async function roleSnapshot(
    tx: DBExecutor,
    tenantId: string,
    roleId: string,
  ) {
    const [found] = await tx
      .select({ id: role.id })
      .from(role)
      .where(and(eq(role.id, roleId), eq(role.tenantId, tenantId)))
      .for("share");
    if (!found) throw new ProjectError(404, "invitation_role_not_found");
    const rows = await tx
      .select()
      .from(grant)
      .where(and(eq(grant.roleId, roleId), eq(grant.tenantId, tenantId)))
      .orderBy(grant.id)
      .limit(1001);
    if (rows.length > 1000)
      throw new ProjectError(403, "invitation_role_too_large");
    const digest = sha256Hex(
      canonicalJsonStringify(
        rows.map((row) => ({
          id: row.id,
          resource: row.resource,
          action: row.action,
          effect: row.effect,
          origin: row.origin,
          roleId: row.roleId,
          principalId: row.principalId,
          conditions: row.conditions,
          expiresAt: row.expiresAt?.toISOString() ?? null,
        })),
      ),
    );
    return { rows, digest };
  }
  async function currentRecipient(tx: DBExecutor, userId: string) {
    const [person] = await tx
      .select({ id: user.id, email: user.email, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .for("share");
    if (!person?.verified)
      throw new ProjectError(403, "verified_email_required");
    const [password] = await tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          eq(account.providerId, "credential"),
          sql`${account.password} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (!password) throw new ProjectError(403, "password_account_required");
    return person;
  }
  async function invitedIssuer(row: InvitationRow) {
    const [member] = await db
      .select({ userId: principal.refId })
      .from(principal)
      .where(
        and(
          eq(principal.id, row.invitedBy),
          eq(principal.tenantId, row.tenantId),
          eq(principal.kind, "user"),
          eq(principal.status, "active"),
        ),
      );
    if (!member) throw new ProjectError(403, "invitation_delegation_refused");
    const actor = {
      tenantId: row.tenantId,
      principalId: row.invitedBy,
      userId: member.userId,
    };
    const allowed = await issuer(actor);
    if (!(await allowed(`role:${row.roleId}`, "read")))
      throw new ProjectError(403, "invitation_delegation_refused");
    return nativeGrants.collectGrants(row.invitedBy, row.tenantId);
  }

  return {
    async create(actor: Actor, value: unknown) {
      const body = CreateInvitation(value);
      if (body instanceof type.errors)
        throw new ProjectError(400, "invalid_invitation");
      const email = body.email.trim().toLowerCase();
      const allowed = await issuer(actor);
      if (!(await allowed(`role:${body.roleId}`, "read")))
        throw new ProjectError(403, "invitation_management_refused");
      const grants = await nativeGrants.collectGrants(
        actor.principalId,
        actor.tenantId,
      );
      const payloadSha256 = sha256Hex(
        canonicalJsonStringify({
          email,
          roleId: body.roleId,
          expiresAt: body.expiresAt,
        }),
      );
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${canonicalJsonStringify(["invitation", actor.tenantId, actor.principalId, body.idempotencyKey])},0))`,
        );
        const now = await databaseTime(tx);
        const [prior] = await tx
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.tenantId, actor.tenantId),
              eq(invitation.invitedBy, actor.principalId),
              eq(invitation.idempotencyKey, body.idempotencyKey),
            ),
          );
        if (prior) {
          if (prior.payloadSha256 !== payloadSha256)
            throw new ProjectError(409, "idempotency_key_reuse");
          return { invitation: invitationResponse(prior, now), created: false };
        }
        await lockIssuer(tx, actor.principalId, actor.tenantId);
        const expiresAt = invitationDeadline(body.expiresAt, now);
        const preset = await roleSnapshot(tx, actor.tenantId, body.roleId);
        await assertInvitationDelegation(grants, preset.rows);
        const [row] = await tx
          .insert(invitation)
          .values({
            id: crypto.randomUUID(),
            tenantId: actor.tenantId,
            email,
            roleId: body.roleId,
            roleSha256: preset.digest,
            invitedBy: actor.principalId,
            idempotencyKey: body.idempotencyKey,
            payloadSha256,
            expiresAt,
            createdAt: now,
          })
          .returning();
        return { invitation: invitationResponse(row!, now), created: true };
      });
    },
    async list(actor: Actor) {
      const allowed = await issuer(actor);
      if (!(await allowed("principal:*", "read")))
        throw new ProjectError(403, "invitation_management_refused");
      const now = new Date();
      const rows = await db
        .select()
        .from(invitation)
        .where(eq(invitation.tenantId, actor.tenantId))
        .orderBy(desc(invitation.createdAt), desc(invitation.id))
        .limit(100);
      return {
        invitations: rows.map((row) => invitationResponse(row, now)),
        limit: 100,
      };
    },
    async readForRecipient(id: string, userId: string) {
      return db.transaction(async (tx) => {
        const person = await currentRecipient(tx, userId);
        const [row] = await tx
          .select()
          .from(invitation)
          .where(
            and(
              eq(invitation.id, id),
              eq(invitation.email, person.email.trim().toLowerCase()),
            ),
          );
        if (!row) throw new ProjectError(404, "invitation_not_found");
        return invitationResponse(row, await databaseTime(tx));
      });
    },
    async accept(id: string, userId: string) {
      // Read recipient binding before loading issuer authority, masking unrelated ids.
      const visible = await this.readForRecipient(id, userId);
      const [record] = await db
        .select()
        .from(invitation)
        .where(eq(invitation.id, visible.id));
      if (!record) throw new ProjectError(404, "invitation_not_found");
      // Replays return the recorded result; they must never recreate removed access.
      const grants = record.acceptedAt ? [] : await invitedIssuer(record);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(invitation)
          .where(eq(invitation.id, id))
          .for("update");
        const person = await currentRecipient(tx, userId);
        if (!row || row.email !== person.email.trim().toLowerCase())
          throw new ProjectError(404, "invitation_not_found");
        const now = await databaseTime(tx);
        const state = invitationState(row, now);
        if (state === "activated") return invitationResponse(row, now);
        if (state !== "pending")
          throw new ProjectError(409, "invitation_" + state);
        await lockIssuer(tx, row.invitedBy, row.tenantId);
        const preset = await roleSnapshot(tx, row.tenantId, row.roleId);
        if (preset.digest !== row.roleSha256)
          throw new ProjectError(409, "invitation_role_changed");
        await assertInvitationDelegation(grants, preset.rows);
        const created = await principals.createIfAbsent(
          {
            id: crypto.randomUUID(),
            tenantId: row.tenantId,
            kind: "user",
            refId: person.id,
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
          tx,
        );
        const [existing] = created
          ? [created]
          : await tx
              .select()
              .from(principal)
              .where(
                and(
                  eq(principal.tenantId, row.tenantId),
                  eq(principal.kind, "user"),
                  eq(principal.refId, person.id),
                ),
              )
              .for("update");
        if (!existing || existing.status !== "active")
          throw new ProjectError(409, "invitation_membership_conflict");
        // Native membership creation and row locks may wait past the deadline.
        // Reject inside this transaction so a newly created principal/key rolls back too.
        const activatedAt = await databaseTime(tx);
        if (invitationState(row, activatedAt) !== "pending")
          throw new ProjectError(409, "invitation_expired");
        await tx
          .insert(principalRole)
          .values({
            principalId: existing.id,
            roleId: row.roleId,
            createdAt: activatedAt,
          })
          .onConflictDoNothing();
        const [accepted] = await tx
          .update(invitation)
          .set({ acceptedAt: activatedAt, acceptedPrincipalId: existing.id })
          .where(
            and(
              eq(invitation.id, row.id),
              sql`${invitation.expiresAt} > clock_timestamp()`,
            ),
          )
          .returning();
        if (!accepted) throw new ProjectError(409, "invitation_expired");
        return invitationResponse(accepted, activatedAt);
      });
    },
    async revoke(actor: Actor, id: string) {
      const allowed = await issuer(actor);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(invitation)
          .where(
            and(eq(invitation.id, id), eq(invitation.tenantId, actor.tenantId)),
          )
          .for("update");
        if (!row) throw new ProjectError(404, "invitation_not_found");
        const now = await databaseTime(tx);
        if (
          row.invitedBy !== actor.principalId &&
          !(await allowed("principal:*", "manage"))
        )
          throw new ProjectError(403, "invitation_management_refused");
        if (row.acceptedAt)
          throw new ProjectError(409, "invitation_already_activated");
        if (row.revokedAt) return invitationResponse(row, now);
        await lockIssuer(tx, actor.principalId, actor.tenantId);
        const [revoked] = await tx
          .update(invitation)
          .set({ revokedAt: now, revokedBy: actor.principalId })
          .where(eq(invitation.id, id))
          .returning();
        return invitationResponse(revoked!, now);
      });
    },
  };
}
