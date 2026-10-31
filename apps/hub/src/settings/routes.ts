import { settingsWording } from "../config/settings.ts";
import { installRoot } from "../config/install-root.ts";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  createResolveTenant,
  requireAuth,
  type TenantEnv,
} from "@intx/hub-api";
import {
  listVisibleProviders,
  resolveTenantOwnedCredentialById,
  type DB,
} from "@intx/db";
import type { CredentialCipher } from "@intx/types";
import {
  SettingsSave,
  SettingsRecord,
  SettingsReceipt,
  SettingsProviders,
  type ProviderAvailability,
} from "@corbits-builder/schemas/settings";
import { PreferenceRegistry } from "@corbits-builder/schemas/preferences";
import {
  ModelCatalog,
  ProviderTest,
  ProviderTestResult,
} from "@corbits-builder/schemas/models";
import { type } from "arktype";
import { preferenceRegistry } from "../config/preferences.ts";
import type { ProductConfig } from "../config/index.ts";
import {
  EFFORTS,
  MODEL_CHOICE_REFUSALS,
  MODEL_ROLES,
  PROFILES,
  TIERS,
  MODEL_PROVIDERS,
  providerOfRow,
  resolveModelChoice,
} from "../config/models.ts";
import { connectedProviders } from "../projects/model-choice.ts";
import {
  createAvailabilityProbe,
  probeKey,
  type AvailabilityState,
} from "../availability.ts";
import { reportAuthorization } from "../projects/authorization.ts";
import { createSettingsService } from "./service.ts";
import { ProjectError } from "../projects/errors.ts";

const isJsonRequest = (c: Context<TenantEnv>) =>
  /^application\/json(?:\s*;|$)/i.test(c.req.header("content-type") ?? "");

const actor = (c: Context<TenantEnv>) => ({
  tenantId: c.get("tenant").id,
  principalId: c.get("principal").id,
});

function settingsAvailability(
  plugin: string,
  state: AvailabilityState,
): ProviderAvailability {
  if (
    ![
      "openai",
      "openai-compatible",
      "openai-responses",
      "anthropic",
      "google-genai",
    ].includes(plugin)
  )
    return { state: "unsupported" };
  if (state === "connected") return { state: "configured" };
  if (state === "unconfigured")
    return {
      state: "unconfigured",
      requiredOperatorSetup: settingsWording.operatorSetup,
    };
  return {
    state: "unavailable",
    detail: settingsWording.unavailable,
  };
}

export function createSettingsRoutes(
  db: DB["db"],
  cipher: CredentialCipher,
  config: ProductConfig,
  installRootId: string,
) {
  const app = new Hono<TenantEnv>();
  const service = createSettingsService(db);
  const probe = createAvailabilityProbe(db, cipher);
  app.use("*", requireAuth, createResolveTenant({ db }));
  app.use(
    "*",
    bodyLimit({
      maxSize: 32 * 1024,
      onError: (c) => c.json({ code: "settings_request_too_large" }, 413),
    }),
  );
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code, ...error.details }, error.status);
    throw error;
  });
  app.get(
    "/providers",
    describeRoute({
      tags: ["Settings"],
      operationId: "settingsProviders",
      responses: {
        200: {
          description:
            "Native provider availability and secret-set booleans; no credential values",
          content: {
            "application/json": { schema: resolver(SettingsProviders) },
          },
        },
      },
    }),
    async (c) => {
      const { tenantId } = actor(c);
      const allowed = await reportAuthorization(db, actor(c));
      if (!(await allowed("sb-settings:tenant", "read")))
        throw new ProjectError(403, "forbidden");
      const providers = [];
      for (const { row } of await listVisibleProviders(db, tenantId)) {
        if (!(await allowed(`model-provider:${row.id}`, "read"))) continue;
        const credential = row.credentialId
          ? await resolveTenantOwnedCredentialById(
              db,
              tenantId,
              row.credentialId,
            )
          : null;
        providers.push({
          id: row.id,
          name: row.name,
          availability: settingsAvailability(
            row.plugin,
            await probe(tenantId, row.id),
          ),
          secrets: { credential: { set: Boolean(credential) } },
        });
      }
      return c.json({ providers });
    },
  );
  for (const path of ["/tenant", "/projects/:projectId"] as const) {
    app.get(
      path,
      describeRoute({
        tags: ["Settings"],
        operationId: path === "/tenant" ? "tenantSettings" : "projectSettings",
        responses: {
          200: {
            description: "Versioned nonsecret settings fields",
            content: {
              "application/json": { schema: resolver(SettingsRecord) },
            },
          },
        },
      }),
      async (c) =>
        c.json(await service.read(actor(c), c.req.param("projectId"))),
    );
    app.post(
      `${path}/save`,
      describeRoute({
        tags: ["Settings"],
        operationId: `${path === "/tenant" ? "tenant" : "project"}SettingsSave`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: resolver(SettingsSave) } },
        },
        responses: {
          200: {
            description: "Saved fields and per-field conflicts",
            content: {
              "application/json": { schema: resolver(SettingsReceipt) },
            },
          },
          409: { description: "Idempotency conflict" },
        },
      }),
      async (c) => {
        if (!isJsonRequest(c))
          return c.json({ code: "json_content_type_required" }, 415);
        const input = await c.req.json().catch(() => null);
        return c.json(
          await service.save(actor(c), c.req.param("projectId"), input),
        );
      },
    );
  }
  app.get(
    "/preferences",
    describeRoute({
      tags: ["Settings"],
      operationId: "preferenceRegistry",
      responses: {
        200: {
          description:
            "The preferences a person can set, with their options and defaults",
          content: {
            "application/json": { schema: resolver(PreferenceRegistry) },
          },
        },
      },
    }),
    (c) => c.json(preferenceRegistry()),
  );
  app.get(
    "/models",
    describeRoute({
      tags: ["Settings"],
      operationId: "modelCatalog",
      responses: {
        200: {
          description:
            "The providers a person can connect, with each connection's live status; no credential values",
          content: { "application/json": { schema: resolver(ModelCatalog) } },
        },
      },
    }),
    async (c) => {
      const allowed = await reportAuthorization(db, actor(c));
      if (!(await allowed("sb-settings:tenant", "read")))
        throw new ProjectError(403, "forbidden");
      const { tenantId } = actor(c);
      const visible = [];
      for (const { row, origin } of await listVisibleProviders(db, tenantId))
        if (await allowed(`model-provider:${row.id}`, "read"))
          visible.push({ row, fromServer: origin.tenantId === installRootId });
      const connections = await Promise.all(
        visible.map(async ({ row, fromServer }) => ({
          entry: providerOfRow(row)?.id,
          id: row.id,
          name: row.name,
          status: row.disabled
            ? ("unavailable" as const)
            : await probe(tenantId, row.id),
          credentialSet: row.credentialId !== null,
          ...(fromServer ? { note: installRoot.connectionNote } : {}),
        })),
      );
      const answering = new Set(
        connections
          .filter((row) => row.status === "connected")
          .map((row) => row.entry),
      );
      const automatic = resolveModelChoice(
        null,
        await connectedProviders(db, tenantId),
      );
      return c.json({
        providers: MODEL_PROVIDERS.map(({ quirks: _quirks, ...entry }) => ({
          ...entry,
          models: [...entry.models],
          // A stored row name is the catalog's unique key, not something a person chose.
          connections: connections
            .filter((connection) => connection.entry === entry.id)
            .map(({ entry: _entry, ...connection }, index) => ({
              ...connection,
              name: `${entry.label}${index === 0 ? "" : ` ${index + 1}`}`,
            })),
        })),
        roles: MODEL_ROLES.map(({ id, label, hint, tier }) => ({
          id,
          label,
          hint,
          tier,
        })),
        tiers: [...TIERS],
        efforts: [...EFFORTS],
        ...("refused" in automatic
          ? {
              unresolved: {
                code: automatic.refused,
                message: MODEL_CHOICE_REFUSALS[automatic.refused],
              },
            }
          : { automaticProfile: automatic.choice.profile }),
        profiles: PROFILES.map((profile) => ({
          ...profile,
          available: Object.values(profile.tiers).every((binding) =>
            answering.has(binding.provider),
          ),
        })),
      });
    },
  );
  app.post(
    "/providers/test",
    describeRoute({
      tags: ["Settings"],
      operationId: "testProvider",
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ProviderTest) } },
      },
      responses: {
        200: {
          description:
            "Whether the provider's model list answered this key; the key is not kept",
          content: {
            "application/json": { schema: resolver(ProviderTestResult) },
          },
        },
        400: { description: "Unknown provider or missing base URL" },
      },
    }),
    async (c) => {
      const allowed = await reportAuthorization(db, actor(c));
      if (!(await allowed("sb-settings:tenant", "read")))
        throw new ProjectError(403, "forbidden");
      const input = ProviderTest(await c.req.json().catch(() => null));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_provider_test");
      const entry = providerOfRow({
        plugin: input.plugin,
        baseURL: input.baseURL?.trim() ?? "",
      });
      if (!entry) throw new ProjectError(400, "unknown_provider");
      if (entry.kind === "login")
        throw new ProjectError(400, "provider_signs_in");
      const baseURL = entry.needsBaseUrl
        ? input.baseURL?.trim()
        : entry.baseURL;
      if (!baseURL) throw new ProjectError(400, "base_url_required");
      return c.json({
        status: await probeKey(entry.plugin, baseURL, input.secret),
      });
    },
  );
  app.get(
    "/me",
    describeRoute({
      tags: ["Settings"],
      operationId: "personalSettings",
      responses: {
        200: {
          description: "The signed-in person's own versioned settings fields",
          content: { "application/json": { schema: resolver(SettingsRecord) } },
        },
      },
    }),
    async (c) => c.json(await service.readPersonal(actor(c))),
  );
  app.post(
    "/me/save",
    describeRoute({
      tags: ["Settings"],
      operationId: "personalSettingsSave",
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(SettingsSave) } },
      },
      responses: {
        200: {
          description: "Saved fields and per-field conflicts",
          content: {
            "application/json": { schema: resolver(SettingsReceipt) },
          },
        },
        409: { description: "Idempotency conflict" },
      },
    }),
    async (c) => {
      if (!isJsonRequest(c))
        return c.json({ code: "json_content_type_required" }, 415);
      const input = await c.req.json().catch(() => null);
      return c.json(await service.save(actor(c), undefined, input, true));
    },
  );
  return app;
}
