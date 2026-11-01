import { type } from "arktype";
import { and, eq, sql } from "drizzle-orm";
import { listVisibleProviders, type DB, type DBExecutor } from "@intx/db";
import { tenant } from "@intx/db/schema";
import {
  SettingsSave,
  type SettingsRecord,
  type SettingsReceipt,
} from "@corbits-builder/schemas/settings";
import { ProjectId } from "@corbits-builder/schemas/project";
import {
  project,
  settingsRecord,
  mutationReceipt,
  outbox,
} from "../db/schema.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { ProjectError, projectResource } from "../projects/errors.ts";
import {
  loadSettings,
  loadSettingsAt,
  personalScopeKey,
  reduceSettings,
  settingsScopeKey,
  validateProviderOverride,
} from "./policy.ts";
import { invalidPreference } from "../config/preferences.ts";
import { invalidModelChoice } from "../config/models.ts";
import { modelDirectory } from "./custom-providers.ts";
import { digest } from "../lib/digest.ts";
import type { Actor } from "../lib/actor.ts";

const record = (
  fields: SettingsRecord["fields"],
  projectId?: string,
  personal = false,
): SettingsRecord => ({
  scope: personal ? "personal" : projectId ? "project" : "tenant",
  ...(projectId ? { projectId } : {}),
  fields,
});

export function createSettingsService(db: DB["db"]) {
  async function authorize(
    actor: Actor,
    projectId: string | undefined,
    action: "read" | "manage",
  ) {
    if (projectId && ProjectId(projectId) instanceof type.errors)
      throw new ProjectError(400, "invalid_project_id");
    const allowed = await reportAuthorization(db, actor);
    if (
      !(await allowed(
        projectId ? projectResource(projectId) : "sb-settings:tenant",
        action,
      ))
    )
      throw new ProjectError(403, "forbidden");
    return allowed;
  }
  async function projects(
    tx: DBExecutor,
    actor: Actor,
    projectId?: string,
    lock = false,
  ) {
    const query = tx
      .select()
      .from(project)
      .where(
        and(
          eq(project.tenantId, actor.tenantId),
          ...(projectId ? [eq(project.id, projectId)] : []),
        ),
      )
      .orderBy(project.id);
    const rows = await (lock ? query.for("update") : query);
    if (projectId && !rows.length)
      throw new ProjectError(404, "project_not_found");
    return rows;
  }
  async function parse(actor: Actor, raw: unknown) {
    const input = SettingsSave(structuredClone(raw));
    if (input instanceof type.errors || Object.keys(input.fields).length === 0)
      throw new ProjectError(400, "invalid_settings_save");
    const preferences = input.fields.preferences?.value;
    const unknown = preferences && invalidPreference(preferences);
    if (unknown)
      throw new ProjectError(400, "unknown_preference", {
        preference: unknown,
      });
    const models = input.fields.models?.value;
    const refused =
      models &&
      invalidModelChoice(await modelDirectory(db, actor.tenantId), models);
    if (refused)
      throw new ProjectError(400, "unknown_model_choice", { choice: refused });
    return input;
  }
  return {
    async read(actor: Actor, projectId?: string) {
      await authorize(actor, projectId, "read");
      return db.transaction(async (tx) => {
        const rows = await projects(tx, actor, projectId);
        const fields = await loadSettings(tx, actor.tenantId, projectId);
        if (projectId && fields.title.value === null)
          fields.title.value = rows[0]!.title;
        return record(fields, projectId);
      });
    },
    // A person's own preferences: no tenant grant decides them, and nobody else reads them.
    readPersonal(actor: Actor) {
      return loadSettingsAt(
        db,
        actor.tenantId,
        personalScopeKey(actor.principalId),
      ).then((fields) => record(fields, undefined, true));
    },
    async save(
      actor: Actor,
      projectId: string | undefined,
      raw: unknown,
      personal = false,
    ): Promise<SettingsReceipt> {
      if (!personal) await authorize(actor, projectId, "manage");
      const input = await parse(actor, raw);
      if (
        personal &&
        Object.keys(input.fields).some(
          (field) => field !== "preferences" && field !== "models",
        )
      )
        throw new ProjectError(
          400,
          "personal_settings_are_preferences_and_models_only",
        );
      if (!personal && input.fields.models)
        throw new ProjectError(400, "models_are_personal_settings");
      if (!personal && !projectId && input.fields.preferences)
        throw new ProjectError(
          400,
          "preferences_are_personal_or_project_settings",
        );
      if (!projectId && input.fields.title)
        throw new ProjectError(400, "title_is_project_setting");
      const scopeKey = personal
        ? personalScopeKey(actor.principalId)
        : settingsScopeKey(projectId);
      const visibleProviders = (
        await listVisibleProviders(db, actor.tenantId)
      ).map(({ row }) => row.name);
      return db.transaction(async (tx) => {
        // Project writers share these locks. Tenant policy changes lock every
        // affected project before the tenant row, keeping admission ordered.
        const rows = personal ? [] : await projects(tx, actor, projectId, true);
        await tx
          .select({ id: tenant.id })
          .from(tenant)
          .where(eq(tenant.id, actor.tenantId))
          .for("update");
        const command = `save_settings:${personal ? "personal" : (projectId ?? "tenant")}`;
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.tenantId, actor.principalId, command, input.idempotencyKey])},0))`,
        );
        const [prior] = await tx
          .select()
          .from(mutationReceipt)
          .where(
            and(
              eq(mutationReceipt.tenantId, actor.tenantId),
              eq(mutationReceipt.actorPrincipalId, actor.principalId),
              eq(mutationReceipt.command, command),
              eq(mutationReceipt.idempotencyKey, input.idempotencyKey),
            ),
          );
        const payloadSha256 = digest(input);
        if (prior) {
          if (prior.payloadSha256 !== payloadSha256)
            throw new ProjectError(409, "idempotency_conflict");
          return JSON.parse(prior.resultBody) as SettingsReceipt;
        }
        const current = await loadSettingsAt(tx, actor.tenantId, scopeKey);
        if (projectId && current.title.value === null)
          current.title.value = rows[0]!.title;
        const reduced = reduceSettings(current, input);
        if (reduced.savedFields.includes("providerNames")) {
          const names = reduced.fields.providerNames.value;
          if (
            names?.some((name) => !visibleProviders.includes(name)) ||
            (names && new Set(names).size !== names.length)
          )
            throw new ProjectError(400, "unknown_or_duplicate_provider");
          const tenantFields = await loadSettings(tx, actor.tenantId);
          if (projectId) {
            if (
              validateProviderOverride(names, tenantFields.providerNames.value)
            )
              throw new ProjectError(
                400,
                "provider_override_exceeds_tenant_policy",
              );
          } else {
            const overrides = await tx
              .select()
              .from(settingsRecord)
              .where(eq(settingsRecord.tenantId, actor.tenantId));
            if (
              overrides.some(
                (r) =>
                  r.projectId &&
                  validateProviderOverride(r.fields.providerNames.value, names),
              )
            )
              throw new ProjectError(
                409,
                "tenant_policy_conflicts_with_project_override",
              );
          }
        }
        const result: SettingsReceipt = {
          record: record(reduced.fields, projectId, personal),
          savedFields: reduced.savedFields,
          conflicts: reduced.conflicts,
        };
        if (reduced.savedFields.length) {
          await tx
            .insert(settingsRecord)
            .values({
              tenantId: actor.tenantId,
              scopeKey,
              projectId: projectId ?? null,
              fields: reduced.fields,
            })
            .onConflictDoUpdate({
              target: [settingsRecord.tenantId, settingsRecord.scopeKey],
              set: { fields: reduced.fields },
            });
          if (projectId) {
            await tx
              .update(project)
              .set({
                ...(reduced.savedFields.includes("title")
                  ? { title: reduced.fields.title.value! }
                  : {}),
                updatedAt: new Date(),
              })
              .where(eq(project.id, projectId));
          }
          for (const row of rows)
            await tx.insert(outbox).values({
              id: crypto.randomUUID(),
              projectId: row.id,
              eventType: "settings.saved",
              payload: {
                command: "save_settings",
                actorPrincipalId: actor.principalId,
                scope: projectId ? "project" : "tenant",
                savedFields: reduced.savedFields,
              },
            });
        }
        await tx.insert(mutationReceipt).values({
          tenantId: actor.tenantId,
          actorPrincipalId: actor.principalId,
          command,
          idempotencyKey: input.idempotencyKey,
          payloadSha256,
          resultBody: JSON.stringify(result),
        });
        return result;
      });
    },
  };
}
