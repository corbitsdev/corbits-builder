import { settingsWording } from "./config/settings.ts";
import { createSettingsRoutes } from "./settings/routes.ts";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  createDB,
  createGrantStore,
  createPrincipalStore,
  createPrincipalKeyStore,
  createRunTokenStore,
  resolveFrameSenderKey,
  resolveSenderKey,
  resolveSenderPrincipal,
  withExecutableWorkflowRun,
} from "@intx/db";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import {
  HUB_CONDITION_REGISTRY,
  createHubContextMiddleware,
  createCorrespondentGrantMinter,
  createMailTriggeredRunGrantsMaterializer,
  createRequireGrant,
  createResolveTenant,
  mountHubRoutes,
  type AppEnv,
  type GetSession,
} from "@intx/hub-api";
import {
  createAgentRepoStore,
  createAssetService,
  createEventCollectorRegistry,
  createHubSessionLookups,
  createHubSessionOrchestrator,
  createWorkflowHistoryReceiveTracker,
  createReconciliationScheduler,
  createRunCredentialsLoader,
  pushCredentialReconcile,
  type SidecarLookups,
  createSessionService,
  createSidecarCredentialResolver,
  createSidecarRouter,
  createWorkflowRunReader,
} from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { hexDecode, hexEncode } from "@intx/types";
import { createProductConfig } from "./config/index.ts";
import {
  readCoordinatorStartTimeoutMs,
  readHubEnvironment,
  readGoogleEmulateBaseUrl,
  required,
} from "./environment.ts";
import { loadHubSigningKey } from "./signing-key.ts";
import { createWorkspaceRoutes } from "./workspaces.ts";
import { ensureInstallRoot, joinInstallRoot } from "./install-root.ts";
import { readServerProviderKeys } from "./config/install-root.ts";
import { createProjectRoutes } from "./projects/routes.ts";
import { createAppRepositoryRoutes } from "./projects/app-repository.ts";
import { createInstalledCoordinatorStartup } from "./projects/coordinator-startup.ts";
import { createConversationRoutes } from "./mail/conversation-routes.ts";
import { mountModelLogins } from "./inference/oauth-login.ts";
import { createWorkflowMailPersistence } from "./projects/report-mail.ts";
import {
  createSpecialistEndNotices,
  liveSpecialistRuns,
} from "./projects/specialist-ended.ts";
import { createCoordinatorResumeContext } from "./projects/coordinator-resume.ts";
import { createCoordinatorUpgrades } from "./projects/coordinator-upgrade.ts";
import { coordinatorUpgrade } from "./config/coordinator-upgrade.ts";
import { installForTenant } from "./workflows/install-for-tenant.ts";
import { createHubMail, hubRequestSession } from "./mail/hub-mail.ts";
import { join } from "node:path";
import { createProductRoutes } from "./product.ts";
import {
  createHubAuth,
  authMethods,
  GOOGLE_EMULATE_DEFAULT_CLIENT,
} from "./auth.ts";
import { createAuthEmail } from "./auth-email.ts";
import { createAuthMethodsRoutes } from "./auth-methods.ts";
import { createInvitationRoutes } from "./invitations/routes.ts";
import { ProjectError } from "./projects/errors.ts";
import { mountHubOpenAPI } from "./openapi.ts";
import {
  correlationMiddleware,
  requestContext,
} from "./middleware/correlation.ts";
import { createAvailabilityRoutes } from "./availability.ts";
import { createGitTokenBoundary } from "./git-token-boundary.ts";
import { createSidecarWebSocket } from "./sidecar-websocket.ts";
import { createCoordinatorCredentialRefresh } from "./auth/coordinator-credential-refresh.ts";
import { createAgentTokenBridge } from "./auth/agent-token-bridge.ts";
import { prepareMailTriggeredSpecialistGrants } from "./auth/specialist-project-grant.ts";
import {
  createCoordinatorRoutes,
  createCoordinatorTokenRevocationRoutes,
} from "./auth/coordinator-routes.ts";
import { createWorkflowServices } from "./provisioning/workflow-services.ts";
import { createWorkflowRunStreamRoutes } from "./run-stream.ts";
import { createAgentActivity } from "./artifacts/activity.ts";
import { requestErrorMetadata } from "./request-error.ts";
import { createLiveAppProxy } from "./live-app/proxy.ts";
import { createLiveAppRunner } from "./live-app/runner.ts";
import { mountWebUi } from "./web-ui.ts";
import { version } from "../package.json";

const log = getLogger(["corbits-builder", "hub"]);

export async function createHubRuntime(
  rawEnvironment: Record<string, string | undefined> = process.env,
) {
  const env = readHubEnvironment(rawEnvironment);
  const coordinatorStartTimeoutMs =
    readCoordinatorStartTimeoutMs(rawEnvironment);
  const handle = createDB(env.database);
  let authEmail: ReturnType<typeof createAuthEmail>;
  try {
    await handle.db.execute(sql`select 1`);
    const publicURL = new URL(rawEnvironment["HUB_PUBLIC_URL"] ?? env.baseURL);
    if (
      !["http:", "https:"].includes(publicURL.protocol) ||
      publicURL.username ||
      publicURL.password
    ) {
      throw new Error(
        "HUB_PUBLIC_URL must be an HTTP(S) URL without credentials",
      );
    }
    const config = createProductConfig(rawEnvironment);
    authEmail = createAuthEmail(rawEnvironment, config);
    // Local development: the loopback emulator answers for Google with seeded
    // users, so the sign-in flow runs without real Google credentials. Real
    // credentials still take precedence when both are provided.
    const emulateBaseUrl = readGoogleEmulateBaseUrl(rawEnvironment);
    const authGoogleConfig = emulateBaseUrl
      ? {
          clientId:
            rawEnvironment["GOOGLE_CLIENT_ID"] ??
            GOOGLE_EMULATE_DEFAULT_CLIENT.clientId,
          clientSecret:
            rawEnvironment["GOOGLE_CLIENT_SECRET"] ??
            GOOGLE_EMULATE_DEFAULT_CLIENT.clientSecret,
          emulateBaseUrl,
        }
      : rawEnvironment["GOOGLE_CLIENT_ID"] &&
          rawEnvironment["GOOGLE_CLIENT_SECRET"]
        ? {
            clientId: rawEnvironment["GOOGLE_CLIENT_ID"],
            clientSecret: rawEnvironment["GOOGLE_CLIENT_SECRET"],
          }
        : undefined;
    const credentialCipher = createEnvKeyCredentialCipher(
      hexDecode(env.credentialKey),
    );
    const principalKeyStore = createPrincipalKeyStore({
      db: handle.db,
      cipher: createEnvKeyCredentialCipher(hexDecode(env.principalKey)),
    });
    const installRootId = await ensureInstallRoot(
      handle.db,
      credentialCipher,
      readServerProviderKeys(rawEnvironment),
    );
    const rootPrincipals = createPrincipalStore(handle.db, principalKeyStore);
    const auth = createHubAuth(handle.db, {
      onUserCreated: (userId) =>
        joinInstallRoot(handle.db, rootPrincipals, installRootId, userId),
      baseURL: env.baseURL,
      secret: required(rawEnvironment, "BETTER_AUTH_SECRET"),
      trustedOrigins: [
        ...new Set([
          new URL(env.baseURL).origin,
          publicURL.origin,
          env.uiOrigin,
        ]),
      ],
      device: {
        verificationUri: new URL("/device", publicURL.origin).toString(),
      },
      ...(env.allowedEmails ? { allowedEmails: env.allowedEmails } : {}),
      ...(authEmail
        ? {
            verifyEmail: authEmail.verifyEmail,
            resetPassword: authEmail.resetPassword,
            magicLink: authEmail.magicLink,
          }
        : {}),
      ...(authGoogleConfig ? { google: authGoogleConfig } : {}),
    });
    const reportMailDirectory = join(env.dataDir, "report-mail");
    const key = await loadHubSigningKey(env.dataDir);
    const agentRepoStore = createAgentRepoStore({
      dataDir: env.dataDir,
      signingKey: key,
    });
    const httpRegistries = new Map([
      ["npmjs", { url: "https://registry.npmjs.org" }],
    ]);
    const assetService = createAssetService({
      db: handle.db,
      repoStore: agentRepoStore.repoStore,
      reservedPackageRegistryNames: new Set(httpRegistries.keys()),
    });
    const nativeGrants = createGrantStore(handle.db);
    const runTokenStore = createRunTokenStore({
      db: handle.db,
      cipher: credentialCipher,
    });
    const loadRunCredentials = createRunCredentialsLoader({
      db: handle.db,
      runTokenStore,
      hubApiOrigin: env.hubApiOrigin,
    });
    const historyReceives = createWorkflowHistoryReceiveTracker();
    const nativeLookups = createHubSessionLookups({
      db: handle.db,
      agentRepoStore,
      historyReceives,
    });
    const mailTriggeredRunGrants = createMailTriggeredRunGrantsMaterializer({
      db: handle.db,
      principalKeyStore,
      runTokenStore,
      grantStore: nativeGrants,
      registry: HUB_CONDITION_REGISTRY,
    });
    const lookups: SidecarLookups = {
      ...nativeLookups,
      persistMail: createWorkflowMailPersistence({
        db: handle.db,
        directory: reportMailDirectory,
      }),
      materializeMailTriggeredRunGrants: async (args) => {
        await prepareMailTriggeredSpecialistGrants(
          handle.db,
          args.agentAddress,
        );
        return mailTriggeredRunGrants(args);
      },
      loadRunCredentials,
      resolveSenderKey: (address) =>
        resolveFrameSenderKey(handle.db, principalKeyStore, address),
      resolveSenderKeyStrict: async (address) =>
        (await resolveSenderKey(handle.db, principalKeyStore, address))
          ?.publicKey ?? null,
      resolveSenderPrincipal: (address) =>
        resolveSenderPrincipal(handle.db, principalKeyStore, address),
      mintCorrespondentGrant: createCorrespondentGrantMinter({
        db: handle.db,
        principalKeyStore,
      }),
    };
    const sidecarCredentials = createSidecarCredentialResolver({
      db: handle.db,
    });
    const sidecarRouter = createSidecarRouter({
      hubPublicKey: hexEncode(key.publicKey),
      authenticateSidecar: async ({ token }) =>
        sidecarCredentials.resolve(token),
      validateSidecarIdentity: sidecarCredentials.isCurrent,
      withExecutableWorkflowRun: (target, send, signal) =>
        withExecutableWorkflowRun(handle.db, target, send, signal),
      resolveSidecarBindings: sidecarCredentials.resolveBindings,
      lookups,
    });
    lookups.resyncCredentials = (address) => {
      void pushCredentialReconcile(
        handle.db,
        sidecarRouter,
        address,
        credentialCipher,
        loadRunCredentials,
      );
    };
    const sessionService = createSessionService({
      sidecarRouter,
      sidecarAllocationRouter: sidecarRouter,
      agentRepoStore,
      assetService,
      db: handle.db,
      toolPackageRegistries: { httpRegistries, defaultRegistry: "npmjs" },
      loadRunCredentials,
    });
    const eventCollectors = createEventCollectorRegistry({
      db: handle.db,
      onTurnFinalized(address, turn) {
        sidecarRouter.dispatchAgentEvent(address, {
          type: "turn.committed",
          data: {
            turnId: turn.turnId,
            status: turn.status,
            text: turn.text,
            hadReply: turn.hadReply,
            hadError: turn.hadError,
            errors: turn.errors,
            toolCalls: turn.toolCalls,
            toolErrors: turn.toolErrors,
          },
        });
      },
    });
    const sessions = createHubSessionOrchestrator({
      events: sidecarRouter.events,
      router: sidecarRouter,
      db: handle.db,
      eventCollectors,
    });
    const workflows = await createWorkflowServices({
      db: handle.db,
      router: sidecarRouter,
      sessionService,
      repos: agentRepoStore,
      historyReceives,
      cipher: credentialCipher,
      principalKeyStore,
      environment: rawEnvironment,
      publicURL,
      hubId: hexEncode(key.publicKey).slice(0, 24),
    });
    const allocation = workflows.services.workflowAllocationService;
    const coordinatorStartup = createInstalledCoordinatorStartup(
      handle.db,
      assetService,
      async (args) => {
        const minted = (prefix: "run_" | "ses_") =>
          prefix +
          Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
            "hex",
          );
        try {
          const prepared = await allocation.prepareProvisionedDeployment({
            tenantId: args.tenantId,
            anchorRunId: minted("run_"),
            deploymentDomain: args.domain,
            source: args.deployment.source,
            entry: args.deployment.entry,
            pin: args.deployment.pin,
            definitionAssetId: args.deployment.source.assetId,
            sessionId: minted("ses_"),
            sourceAuthorityPrincipalId: args.principalId,
            sourceOfferingIds: args.deployment.sourceOfferingIds,
            defaultSourceOfferingId: args.deployment.defaultSourceOfferingId,
            deployContent: { systemPrompt: "" },
          });
          return { runId: prepared.anchorRunId };
        } catch (error) {
          log.error("Coordinator deploy failed", {
            tenantId: args.tenantId,
            errorType: error instanceof Error ? error.name : "UnknownError",
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
      coordinatorStartTimeoutMs,
      workflows.services.workflowLifecycleService.requestCancellation,
    );
    const coordinatorUpgrades = createCoordinatorUpgrades({
      db: handle.db,
      runs: createWorkflowRunReader(agentRepoStore.repoStore),
      installed: (actor, projectId) =>
        installForTenant(
          { db: handle.db, assets: assetService },
          actor,
          projectId,
        ),
      startup: coordinatorStartup,
      cancel: workflows.services.workflowLifecycleService.requestCancellation,
    });
    const sidecarWebSocket = createSidecarWebSocket(sidecarRouter);
    const agentActivity = createAgentActivity(sidecarRouter.events);
    const getSession: GetSession = async (headers) => {
      const hub = hubRequestSession(headers);
      if (hub) return hub;
      const result = await auth.api.getSession({ headers });
      return result ? { user: result.user, session: result.session } : null;
    };
    const gitTokens = createGitTokenBoundary(nativeGrants);
    const requireGrant = createRequireGrant({
      grantStore: gitTokens.grantStore,
      conditionRegistry: gitTokens.conditionRegistry,
    });
    const sessionCookieName = (await auth.$context).authCookies.sessionToken
      .name;
    const app = new Hono<AppEnv>();
    const liveAppProxy = createLiveAppProxy({
      hostname: env.hostname,
      publicOrigin: new URL(env.uiOrigin),
      hubCookiePrefix: sessionCookieName.split(".")[0] + ".",
      authorize: async (request, scope) => {
        const headers = new Headers();
        for (const name of ["cookie", "authorization"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        const path = `/api/tenants/${encodeURIComponent(scope.tenantId)}/projects/${encodeURIComponent(scope.projectId)}/artifacts`;
        return (
          await app.fetch(
            new Request(new URL(path, env.hubApiOrigin).href, { headers }),
          )
        ).ok;
      },
    });
    app.use(correlationMiddleware());
    const liveApps = {
      proxy: liveAppProxy,
      runner: createLiveAppRunner({
        dataDir: env.dataDir,
        lastUsed: liveAppProxy.lastUsed,
        onStop: liveAppProxy.withdraw,
      }),
    };
    app.use(liveAppProxy.refuseAppOrigins);
    app.use(createHubContextMiddleware({ getSession }));
    app.use(gitTokens.middleware);
    const coordinatorTokens = createAgentTokenBridge(handle.db, runTokenStore);
    app.use("/api/tenants/:tenantId/*", coordinatorTokens.middleware);
    app.use("/api/workflow-project-scope", coordinatorTokens.middleware);
    app.use(
      "/api/tenants/:tenantId/credentials/:credentialId",
      createCoordinatorCredentialRefresh({
        db: handle.db,
        router: sidecarRouter,
        cipher: credentialCipher,
        loadRunCredentials,
      }),
    );
    app.route(
      "/api/integrations",
      createAuthMethodsRoutes(
        authMethods(
          {
            google: authGoogleConfig !== undefined,
            allowedEmails: env.allowedEmails,
          },
          authEmail !== undefined,
        ),
      ),
    );
    app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
    app.use(
      "/api/tenants/:tenantId/workflows/runs/:runId/stream",
      createResolveTenant({ db: handle.db }),
    );
    app.route(
      "/api/tenants/:tenantId",
      createWorkflowRunStreamRoutes({
        db: handle.db,
        sidecarRouter,
        requireGrant,
      }),
    );
    app.use(
      "/api/tenants/:tenantId/workflows/runs/:runId/mail",
      createCoordinatorResumeContext({
        db: handle.db,
        runs: createWorkflowRunReader(agentRepoStore.repoStore),
        repoStore: agentRepoStore.repoStore,
      }),
    );
    mountHubRoutes(app, {
      db: handle.db,
      sidecarRouter,
      sessionService,
      eventCollectors,
      ...workflows.services,
      sidecarWsHandler: sidecarWebSocket.handler,
      credentialCipher,
      principalKeyStore,
      grantStore: gitTokens.grantStore,
      conditionRegistry: gitTokens.conditionRegistry,
      assetService,
      repoStore: agentRepoStore.repoStore,
      maxTarballBytes: 10 * 1024 * 1024,
    });
    const invitations = createInvitationRoutes({
      db: handle.db,
      principalKeyStore,
      publicURL,
      notify: authEmail?.notifyInvitation,
    });
    app.route("/api/tenants/:tenantId/invitations", invitations.management);
    app.route("/api/invitations", invitations.recipient);
    app.route(
      "/api/tenants/:tenantId/projects",
      createConversationRoutes(handle.db, (request) => app.fetch(request), {
        repoStore: agentRepoStore.repoStore,
        mailDirectory: reportMailDirectory,
      }),
    );
    app.route(
      "/api/tenants/:tenantId/projects",
      createProjectRoutes(
        handle.db,
        createWorkflowRunReader(agentRepoStore.repoStore),
        coordinatorTokens.authenticateProject,
        {
          ensure: (actor, projectId) =>
            coordinatorStartup.ensure(actor, projectId),
          attached: (actor, projectId) =>
            coordinatorStartup.attached(actor, projectId),
          ...(coordinatorUpgrade.enabled
            ? { upgrade: coordinatorUpgrades.open }
            : {}),
        },
        async (actor, projectId) => {
          const bound = await coordinatorStartup.release(actor, projectId);
          const specialists = await liveSpecialistRuns(
            handle.db,
            actor.tenantId,
          );
          for (const runId of bound
            ? [bound.runId, ...specialists]
            : specialists)
            await workflows.services.workflowLifecycleService.requestCancellation(
              actor.tenantId,
              runId,
              "project_archived",
            );
        },
        async (request) => app.fetch(request),
        agentActivity,
        workflows.localSidecarDataDir,
        liveApps,
        workflows.services.workflowLifecycleService.requestCancellation,
        agentRepoStore.repoStore,
      ),
    );
    app.route(
      "/api/tenants/:tenantId/projects",
      createAppRepositoryRoutes(
        handle.db,
        assetService,
        coordinatorTokens.authenticateProject,
      ),
    );
    app.route(
      "/api/tenants/:tenantId/projects",
      createCoordinatorRoutes(handle.db),
    );
    app.route(
      "/api/tenants/:tenantId",
      createCoordinatorTokenRevocationRoutes(handle.db),
    );
    app.route(
      "/api/tenants/:tenantId/product",
      createProductRoutes(handle.db, config),
    );
    app.route(
      "/api/workspaces",
      createWorkspaceRoutes(handle.db, installRootId, async (request) =>
        app.fetch(request),
      ),
    );
    if (settingsWording.enabled)
      app.route(
        "/api/tenants/:tenantId/settings",
        createSettingsRoutes(
          handle.db,
          credentialCipher,
          config,
          installRootId,
        ),
      );
    const modelLogins = mountModelLogins(app, {
      db: handle.db,
      cipher: credentialCipher,
      sidecarRouter,
      requireGrant,
    });
    app.route(
      "/api/tenants/:tenantId/availability",
      createAvailabilityRoutes(handle.db, credentialCipher),
    );
    mountHubOpenAPI(app, {
      config,
      version,
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: sessionCookieName,
        },
        deviceBearer: { type: "http", scheme: "bearer" },
        coordinatorBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Corbits run-bound token for a registered coordinator; scoped routes and native grants apply",
        },
      },
    });
    if (env.webDir) mountWebUi(app, env.webDir);
    app.onError((error, c) => {
      if (error instanceof ProjectError)
        return c.json({ code: error.code, ...error.details }, error.status);
      log.error("Hub request failed", requestErrorMetadata(error));
      return c.json(
        {
          error: "internal_error",
          correlationId: requestContext.getStore()?.["correlationId"],
        },
        500,
      );
    });
    const hubMail = createHubMail(
      handle.db,
      async (request) => app.fetch(request),
      env.hubApiOrigin,
    );
    const projectSchedulers = [
      createReconciliationScheduler({
        name: "Specialist end notice",
        reconcileNext: createSpecialistEndNotices({
          db: handle.db,
          runs: createWorkflowRunReader(agentRepoStore.repoStore),
          mailDirectory: reportMailDirectory,
          mail: hubMail,
        }),
        concurrency: 1,
        intervalMs: 5_000,
      }),
    ];
    if (coordinatorUpgrade.enabled)
      projectSchedulers.push(
        createReconciliationScheduler({
          name: "Coordinator upgrade",
          reconcileNext: coordinatorUpgrades.reconcile,
          concurrency: 1,
          intervalMs: 30_000,
        }),
      );
    return {
      app,
      hostname: env.hostname,
      port: env.port,
      websocket: sidecarWebSocket.websocket,
      workflowCapacityConfigured: workflows.configured,
      start() {
        workflows.start();
        for (const scheduler of projectSchedulers) scheduler.start();
      },
      async close() {
        modelLogins.stop();
        for (const scheduler of projectSchedulers) scheduler.stop();
        workflows.stop();
        liveApps.runner.close();
        liveApps.proxy.close();
        agentActivity.dispose();
        sidecarWebSocket.close();
        await workflows.drain();
        sessions.dispose();
        authEmail?.close();
        await handle.close();
      },
    };
  } catch (error) {
    authEmail?.close();
    await handle.close();
    throw error;
  }
}
