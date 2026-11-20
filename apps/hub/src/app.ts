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
  pushCredentialRevoke,
  type SidecarLookups,
  createSessionService,
  createSidecarCredentialResolver,
  createSidecarRouter,
  createWorkflowRunReader,
} from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { hexDecode, hexEncode } from "@intx/types";
import { createProductConfig } from "./config/index.ts";
import type { SandboxToolchains } from "@corbits-builder/schemas/installed-workflows";
import type { HubEnvironment } from "./environment.ts";
import { loadHubSigningKey } from "./signing-key.ts";
import { createWorkspaceRoutes } from "./workspaces.ts";
import { ensureInstallRoot, joinInstallRoot } from "./install-root.ts";
import { serverProviderKeys } from "./config/install-root.ts";
import { createProjectRoutes } from "./projects/routes.ts";
import { createServerKeys } from "./credentials/server-keys.ts";
import { mountPersonServerKeys } from "./credentials/routes.ts";
import { createAppRepositoryRoutes } from "./projects/app-repository.ts";
import { createInstalledCoordinatorStartup } from "./projects/coordinator-startup.ts";
import { createConversationRoutes } from "./mail/conversation-routes.ts";
import {
  mountModelLogins,
  oauthModelProviders,
} from "./inference/oauth-login.ts";
import {
  createRenewedPush,
  startTokenRefresher,
} from "./credentials/refresher.ts";
import { mountPluginSignIns } from "./credentials/sign-in-routes.ts";
import {
  createPluginSignIns,
  signInCredentials,
} from "./credentials/sign-ins.ts";
import { CATALOG } from "./plugins/catalog.ts";
import { signInWording } from "./config/sign-in.ts";
import { createWorkflowMailPersistence } from "./projects/report-mail.ts";
import {
  createSpecialistEndNotices,
  liveSpecialistRuns,
} from "./projects/specialist-ended.ts";
import { createCoordinatorResumeContext } from "./projects/coordinator-resume.ts";
import { createAgentUpgrades } from "./projects/upgrade-agents.ts";
import { agentUpgrade } from "./config/agent-upgrade.ts";
import { installForTenant } from "./workflows/install-for-tenant.ts";
import { createHubMail, hubRequestSession } from "./mail/hub-mail.ts";
import { join, resolve } from "node:path";
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
import { createRunExport } from "./telemetry/run-export.ts";
import { createRunSpans } from "./telemetry/run-spans.ts";
import { createRunTracing } from "./telemetry/run-tracing.ts";
import { createAgentActivity } from "./artifacts/activity.ts";
import { createArtifactService } from "./artifacts/service.ts";
import { createChecks } from "./plugins/checks.ts";
import { createCommandRunner } from "./plugins/command-runner.ts";
import { createAppBuilds } from "./artifacts/app-build.ts";
import { requestErrorMetadata } from "./request-error.ts";
import { createLiveAppProxy } from "./live-app/proxy.ts";
import { createLiveAppRunner } from "./live-app/runner.ts";
import { mountWebUi } from "./web-ui.ts";
import {
  coordinatorAskReader,
  createDeclineNote,
} from "./projects/decline-note.ts";
import { runTelemetry } from "./projects/run-telemetry.ts";
import { version } from "../package.json";

const log = getLogger(["corbits-builder", "hub"]);

export async function createHubRuntime(
  env: HubEnvironment,
  testing?: { toolReplay?: string },
) {
  const handle = createDB(env.database);
  let authEmail: ReturnType<typeof createAuthEmail>;
  try {
    await handle.db.execute(sql`select 1`);
    const publicURL = env.publicURL;
    const config = createProductConfig(env);
    authEmail = createAuthEmail(env, config);
    // Local development: the loopback emulator answers for Google with seeded
    // users, so the sign-in flow runs without real Google credentials. Real
    // credentials still take precedence when both are provided.
    const emulateBaseUrl = env.GOOGLE_EMULATE_URL;
    const authGoogleConfig = emulateBaseUrl
      ? {
          clientId:
            env.GOOGLE_CLIENT_ID ?? GOOGLE_EMULATE_DEFAULT_CLIENT.clientId,
          clientSecret:
            env.GOOGLE_CLIENT_SECRET ??
            GOOGLE_EMULATE_DEFAULT_CLIENT.clientSecret,
          emulateBaseUrl,
        }
      : env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          }
        : undefined;
    const credentialCipher = createEnvKeyCredentialCipher(
      hexDecode(env.CREDENTIAL_ENCRYPTION_KEY),
    );
    const principalKeyStore = createPrincipalKeyStore({
      db: handle.db,
      cipher: createEnvKeyCredentialCipher(
        hexDecode(env.PRINCIPAL_KEY_ENCRYPTION_KEY),
      ),
    });
    const installRootId = await ensureInstallRoot(
      handle.db,
      credentialCipher,
      serverProviderKeys(env),
    );
    const rootPrincipals = createPrincipalStore(handle.db, principalKeyStore);
    const auth = createHubAuth(handle.db, {
      onUserCreated: (userId) =>
        joinInstallRoot(handle.db, rootPrincipals, installRootId, userId),
      baseURL: env.baseURL,
      secret: env.BETTER_AUTH_SECRET,
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
      ...(env.AUTH_ALLOWED_EMAILS
        ? { allowedEmails: env.AUTH_ALLOWED_EMAILS }
        : {}),
      ...(authEmail
        ? {
            verifyEmail: authEmail.verifyEmail,
            resetPassword: authEmail.resetPassword,
            magicLink: authEmail.magicLink,
          }
        : {}),
      ...(authGoogleConfig ? { google: authGoogleConfig } : {}),
    });
    const reportMailDirectory = join(env.HUB_DATA_DIR, "report-mail");
    const key = await loadHubSigningKey(env.HUB_DATA_DIR);
    const agentRepoStore = createAgentRepoStore({
      dataDir: env.HUB_DATA_DIR,
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
      // The router arms 5-minute mail-hold timers and has no shutdown that cancels them;
      // unref them so a hub that has finished closing can exit instead of waiting them out.
      scheduleTimeout: (handler, ms) => {
        const timer = setTimeout(handler, ms);
        timer.unref();
        return () => clearTimeout(timer);
      },
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
      environment: env,
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
      env.COORDINATOR_START_TIMEOUT_MS,
      workflows.services.workflowLifecycleService.requestCancellation,
    );
    const sidecarWebSocket = createSidecarWebSocket(sidecarRouter);
    const agentActivity = createAgentActivity(sidecarRouter.events);
    const runExport = createRunExport(env);
    const runTracing = runExport
      ? createRunTracing({
          events: sidecarRouter.events,
          runSpans: createRunSpans({
            captureContent:
              env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
          }),
          runExport,
          describeRun: (runId) => runTelemetry(handle.db, runId),
        })
      : undefined;
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
    const hubMail = createHubMail(
      handle.db,
      async (request) => app.fetch(request),
      env.hubApiOrigin,
    );
    const agentUpgrades = createAgentUpgrades({
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
      mail: hubMail,
    });
    const liveAppProxy = createLiveAppProxy({
      hostname: env.HOST,
      ports: env.LIVE_APP_PORTS,
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
        dataDir: env.HUB_DATA_DIR,
        lastUsed: liveAppProxy.lastUsed,
        onStop: liveAppProxy.withdraw,
      }),
    };
    app.use(liveAppProxy.refuseAppOrigins);
    app.use(createHubContextMiddleware({ getSession }));
    app.use(gitTokens.middleware);
    const toolchains: SandboxToolchains = {
      paths: env.SANDBOX_TOOLCHAIN_PATHS,
      dataDir: resolve(env.HUB_DATA_DIR),
    };
    if (testing?.toolReplay) toolchains.replay = testing.toolReplay;
    const coordinatorTokens = createAgentTokenBridge(
      handle.db,
      toolchains,
      runTokenStore,
      {
        install: (actor, projectId) =>
          installForTenant(
            { db: handle.db, assets: assetService },
            actor,
            projectId,
          ),
        handoff: agentUpgrades.handoff,
      },
    );
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
            allowedEmails: env.AUTH_ALLOWED_EMAILS,
          },
          authEmail !== undefined,
        ),
      ),
    );
    app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
    for (const path of ["stream", "steps"])
      app.use(
        `/api/tenants/:tenantId/workflows/runs/:runId/${path}`,
        createResolveTenant({ db: handle.db }),
      );
    app.route(
      "/api/tenants/:tenantId",
      createWorkflowRunStreamRoutes({
        db: handle.db,
        sidecarRouter,
        requireGrant,
        repoStore: agentRepoStore.repoStore,
        activity: agentActivity,
      }),
    );
    app.use(
      "/api/tenants/:tenantId/workflows/runs/:runId/mail",
      createCoordinatorResumeContext({
        db: handle.db,
        runs: createWorkflowRunReader(agentRepoStore.repoStore),
        repoStore: agentRepoStore.repoStore,
        pluginHint: env.PLUGIN_HINT,
      }),
    );
    // Only a signed-in member of the tenant reaches the note; Interchange's route reuses the
    // resolved tenant.
    app.use(
      "/api/tenants/:tenantId/approvals/:approvalId/reject",
      createResolveTenant({ db: handle.db }),
      createDeclineNote({ coordinatorAsk: coordinatorAskReader(handle.db) }),
    );
    const savedApps = createArtifactService(
      handle.db,
      createWorkflowRunReader(agentRepoStore.repoStore),
      agentRepoStore.repoStore,
    );
    const commands = createCommandRunner();
    // The hub's one runner of plugins' checks; a result is noted to the coordinator through the
    // hub's own mail route.
    const checks = createChecks({
      db: handle.db,
      toolchains,
      artifacts: savedApps,
      commands,
      fetch: async (request) => app.fetch(request),
    });
    const appBuilds = createAppBuilds({
      db: handle.db,
      artifacts: savedApps,
      commands,
      toolchains,
    });
    // A coder's push to a project's app repository is how its main gets a new commit: once
    // Interchange's receive-pack has moved the ref, the checks the push made stale re-run.
    app.use(
      "/api/tenants/:tenantId/assets/app/:repository/git-receive-pack",
      async (c, next) => {
        await next();
        const projectId = /^app-(.+)\.git$/.exec(
          c.req.param("repository"),
        )?.[1];
        if (c.res.ok && projectId)
          void checks.pushed(projectId, new URL(c.req.url).origin);
      },
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
    // Takes a revoked credential out of the running runs that have it, as Interchange's revoke does.
    const pushRevoke = (tenantId: string, credentialId: string) =>
      void pushCredentialRevoke(
        handle.db,
        sidecarRouter,
        tenantId,
        credentialId,
      );
    const serverKeys = createServerKeys(
      handle.db,
      credentialCipher,
      { allowPrivateAddresses: env.SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES },
      pushRevoke,
    );
    app.route(
      "/api/tenants/:tenantId/projects",
      createConversationRoutes(
        handle.db,
        (request) => app.fetch(request),
        createWorkflowRunReader(agentRepoStore.repoStore),
        {
          repoStore: agentRepoStore.repoStore,
          mailDirectory: reportMailDirectory,
        },
      ),
    );
    app.route(
      "/api/tenants/:tenantId/projects",
      createProjectRoutes(
        handle.db,
        createWorkflowRunReader(agentRepoStore.repoStore),
        agentRepoStore.repoStore,
        coordinatorTokens.authenticateProject,
        {
          ensure: (actor, projectId) =>
            coordinatorStartup.ensure(actor, projectId),
          attached: (actor, projectId) =>
            coordinatorStartup.attached(actor, projectId),
          ...(agentUpgrade.enabled ? { upgrade: agentUpgrades.open } : {}),
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
        checks,
        appBuilds,
        serverKeys,
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
          async (request) => app.fetch(request),
        ),
      );
    const modelProviders = oauthModelProviders();
    mountModelLogins(app, {
      db: handle.db,
      cipher: credentialCipher,
      providers: modelProviders,
      requireGrant,
    });
    const pushRenewed = createRenewedPush({
      db: handle.db,
      cipher: credentialCipher,
      sidecarRouter,
      loadRunCredentials,
    });
    const pluginSignIns = createPluginSignIns({
      db: handle.db,
      cipher: credentialCipher,
      credentials: signInCredentials(CATALOG.credentials),
      publicURL,
      clientName: signInWording(config.naming.productName).clientName,
      pushRevoke,
      pushRenewed: (tenantId, credentialId) =>
        void pushRenewed(tenantId, credentialId),
    });
    mountPersonServerKeys(app, serverKeys, { db: handle.db, requireGrant });
    mountPluginSignIns(app, pluginSignIns, {
      db: handle.db,
      requireGrant,
      productName: config.naming.productName,
    });
    const tokenRefresher = startTokenRefresher({
      db: handle.db,
      cipher: credentialCipher,
      models: modelProviders,
      signIns: pluginSignIns.refreshers,
      pushRenewed,
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
    if (env.HUB_WEB_DIR) mountWebUi(app, env.HUB_WEB_DIR);
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
    const projectSchedulers = [
      createReconciliationScheduler({
        name: "Specialist end notice",
        reconcileNext: createSpecialistEndNotices({
          db: handle.db,
          runs: createWorkflowRunReader(agentRepoStore.repoStore),
          repoStore: agentRepoStore.repoStore,
          mailDirectory: reportMailDirectory,
          mail: hubMail,
        }),
        concurrency: 1,
        intervalMs: 5_000,
      }),
    ];
    // Polls rather than stopping once a deploy has caught up: packages can change without a hub
    // restart, and nothing signals when a project goes quiet. Each pass costs a couple of reads per
    // active project.
    if (agentUpgrade.enabled)
      projectSchedulers.push(
        createReconciliationScheduler({
          name: "Agent upgrade",
          reconcileNext: agentUpgrades.reconcile,
          concurrency: 1,
          intervalMs: 30_000,
        }),
      );
    return {
      app,
      hostname: env.HOST,
      port: env.PORT,
      websocket: sidecarWebSocket.websocket,
      workflowCapacityConfigured: workflows.configured,
      start() {
        workflows.start();
        for (const scheduler of projectSchedulers) scheduler.start();
      },
      async close() {
        tokenRefresher.stop();
        for (const scheduler of projectSchedulers) scheduler.stop();
        workflows.stop();
        liveApps.runner.close();
        liveApps.proxy.close();
        agentActivity.dispose();
        await runTracing?.dispose();
        await runExport?.shutdown();
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
