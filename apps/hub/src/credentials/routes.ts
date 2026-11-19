import { type } from "arktype";
import { Hono, type Context } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { DB } from "@intx/db";
import {
  createResolveTenant,
  requireAuth,
  type AppEnv,
  type RequireGrant,
  type TenantEnv,
} from "@intx/hub-api";
import { getLogger } from "@intx/log";
import {
  PersonServerKeyRefusal,
  PersonServerKeyState,
  ServerAddress,
  ServerKeyBind,
  ServerKeyIssue,
  ServerKeyRefusal,
  ServerKeyRevoked,
  ServerKeyState,
} from "@corbits-builder/schemas/settings";
import type { createArtifactService } from "../artifacts/service.ts";
import { body, security } from "../http/route-parts.ts";
import { CATALOG, runActionOf } from "../plugins/catalog.ts";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { runOwner, type ServerKeys } from "./server-keys.ts";

const log = getLogger(["corbits-builder", "run-credentials"]);

const refusal = (description: string) => ({
  description,
  content: { "application/json": { schema: resolver(ServerKeyRefusal) } },
});
const notProvisioning = {
  description:
    "A caller that is not a live run started for an installed action that provisions the credential",
};

export function mountRunCredentialRoutes(
  app: Hono<TenantEnv>,
  serverKeys: ServerKeys,
  artifacts: ReturnType<typeof createArtifactService>,
) {
  // The live run calling and the plugin the key belongs to, when the installed action the run was
  // started for provisions the credential. Only those runs can make, prove or revoke a credential,
  // and only in the run's own project.
  async function provisioning(c: Context<TenantEnv>) {
    const actor = actorOf(c);
    const projectId = c.req.param("projectId")!;
    const name = c.req.param("name")!;
    const run = await artifacts.liveRun(actor, projectId);
    const asked = {
      projectId,
      plugin: run.plugin,
      action: run.action,
      credential: name,
    };
    const action = await runActionOf(
      artifacts.projectState,
      actor,
      projectId,
      run,
    );
    if (!(action?.builder.provisions ?? []).includes(name))
      throw refusedRun(
        new ProjectError(403, "run_credential_not_provisioned", {
          hint: `${run.plugin} ${run.action} does not provision ${name}, so this run neither asks for nor changes it.`,
        }),
        asked,
      );
    return {
      owner: runOwner(actor.tenantId, projectId, run.plugin),
      name,
      asked,
    };
  }
  // A refused run gets the reason in its answer. Nothing else at the default log level shows that a
  // publish stopped here, so the log records the code and whose run asked.
  function refusedRun(error: unknown, asked: Record<string, string>) {
    if (error instanceof ProjectError)
      log.info("A run's credential ask was refused: {code}", {
        code: error.code,
        ...asked,
      });
    return error;
  }
  async function answering<T>(
    asked: Record<string, string>,
    answer: () => Promise<T>,
  ) {
    try {
      return await answer();
    } catch (error) {
      throw refusedRun(error, asked);
    }
  }
  app.get(
    "/:projectId/run-credentials/:name/key",
    describeRoute({
      tags: ["Credentials"],
      operationId: "readRunServerKey",
      description:
        "A specialist run reads the server key its action provisions under this credential name, as the POST answers it, without the hub making one. The private half is never answered.",
      security,
      responses: {
        200: {
          description: "The key's public half, label and state",
          content: {
            "application/json": { schema: resolver(ServerKeyState) },
          },
        },
        403: notProvisioning,
        404: refusal("No key of this name has been issued"),
        409: refusal(
          "A key of this name made by a person or another plugin, or a credential of this name someone saved",
        ),
      },
    }),
    async (c) => {
      const { owner, name, asked } = await provisioning(c);
      return c.json(
        await answering(asked, () => serverKeys.state(owner, name)),
      );
    },
  );
  app.post(
    "/:projectId/run-credentials/:name/key",
    describeRoute({
      tags: ["Credentials"],
      operationId: "issueRunServerKey",
      description:
        "A specialist run asks for the server key its action provisions under this credential name. The first ask makes an Ed25519 key pair and a label to name the server by where it is rented; every later ask answers with the same key and label, never another. The private half is never answered. Once bound, the answer names the server's address, or says the key is lost when its credential was revoked since.",
      security,
      responses: {
        200: {
          description: "The key's public half, label and state",
          content: {
            "application/json": { schema: resolver(ServerKeyState) },
          },
        },
        403: notProvisioning,
        409: refusal(
          "A key of this name made by a person or another plugin, or a credential of this name someone saved",
        ),
      },
    }),
    async (c) => {
      const { owner, name, asked } = await provisioning(c);
      return c.json(await answering(asked, () => serverKeys.key(owner, name)));
    },
  );
  app.post(
    "/:projectId/run-credentials/:name/bind",
    describeRoute({
      tags: ["Credentials"],
      operationId: "bindRunServerKey",
      description:
        "A specialist run asks the hub to prove its issued server key on the server it rented: host is the server's public IP address and hostKey the SHA256 fingerprint of the host key it must present. The hub signs in on port 22 with the key, pinned to that host key, runs one command that changes nothing, and only then saves the key as the plugin's ssh credential in the project and forgets its own copy of the private half. Binding the same server again changes nothing.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ServerKeyBind) } },
      },
      responses: {
        200: {
          description: "The key as now bound",
          content: {
            "application/json": { schema: resolver(ServerKeyState) },
          },
        },
        400: refusal(
          "No host, or no host key fingerprint in SHA256 form, or a host that is not an IP address",
        ),
        403: notProvisioning,
        409: refusal(
          "No key issued, a key bound to another server, or a key or credential of this name someone else made",
        ),
        422: refusal(
          "A loopback or private address, or a port other than 22, which this hub is not set to reach",
        ),
        502: refusal(
          "The server did not answer, presented another host key or refused the key; asking again once it is up may succeed",
        ),
      },
    }),
    async (c) => {
      const { owner, name, asked } = await provisioning(c);
      const input = ServerKeyBind(await body(c));
      if (input instanceof type.errors)
        throw refusedRun(new ProjectError(400, "invalid_bind"), asked);
      // The bind logs its own refusals, as it does a person's.
      return c.json(await serverKeys.bind(owner, name, input));
    },
  );
  app.post(
    "/:projectId/run-credentials/:name/revoke",
    describeRoute({
      tags: ["Credentials"],
      operationId: "revokeRunServerKey",
      description:
        "A specialist run forgets the server key its plugin made under this credential name and revokes the credential it became, taking it out of every running run that holds it. A key or credential of this name a person or another plugin made is left as it is.",
      security,
      responses: {
        200: {
          description: "Whether a key the plugin made was removed",
          content: {
            "application/json": { schema: resolver(ServerKeyRevoked) },
          },
        },
        403: notProvisioning,
      },
    }),
    async (c) => {
      const { owner, name } = await provisioning(c);
      return c.json(await serverKeys.revoke(owner, name));
    },
  );
}

const personRefusal = (description: string) => ({
  description,
  content: {
    "application/json": { schema: resolver(PersonServerKeyRefusal) },
  },
});
const keyState = (description: string) => ({
  description,
  content: {
    "application/json": { schema: resolver(PersonServerKeyState) },
  },
});
const notAllowed = {
  description: "May not save a key to a server in this tenant",
};

/**
 * The routes a person uses to connect their own server from the plugin's screen. The hub gives them
 * a key and proves it on the server they name, as it does for a run, so the browser never has a
 * private key.
 */
export function mountPersonServerKeys(
  app: Hono<AppEnv>,
  serverKeys: ServerKeys,
  options: { db: DB["db"]; requireGrant: RequireGrant },
) {
  const routes = new Hono<TenantEnv>();
  // Scoped to these paths: this router is mounted at the tenant root beside other routers.
  routes.use(
    "/server-keys/*",
    requireAuth,
    createResolveTenant({ db: options.db }),
    // Only someone who may save a server key here can have the hub make one or dial a server.
    options.requireGrant("provider:*", "create"),
    options.requireGrant("credential:*", "create"),
  );

  // The person's key in the tenant's project, under a server key name that an installed plugin
  // declares for a person to connect. A person can never make or replace a key the hub makes for a
  // plugin's runs.
  async function owner(c: Context<TenantEnv>) {
    const name = c.req.param("name")!;
    if (
      !CATALOG.credentials.some(
        (declared) =>
          declared.name === name &&
          declared.sends === "ssh" &&
          !declared.provisioned,
      )
    )
      throw new ProjectError(404, "server_key_unknown");
    return {
      owner: await serverKeys.personOwner(actorOf(c).tenantId),
      name,
    };
  }

  routes.get(
    "/server-keys/:name/key",
    describeRoute({
      tags: ["Credentials"],
      operationId: "readServerKey",
      description:
        "A person reads the server their project is connected to under this credential name, with the public half of its key, or else the key they were given to connect one, without the hub making one. While a key for another server waits to be connected, the server connected before is the one read.",
      security,
      responses: {
        200: keyState(
          "The connected server's address and key, or the key issued",
        ),
        403: notAllowed,
        404: personRefusal(
          "No installed plugin declares a server key a person connects under that name, or no key is connected or issued",
        ),
        409: personRefusal("The tenant is no project's"),
      },
    }),
    async (c) => {
      const { owner: of, name } = await owner(c);
      return c.json(await serverKeys.personHeld(of, name));
    },
  );
  routes.post(
    "/server-keys/:name/key",
    describeRoute({
      tags: ["Credentials"],
      operationId: "issueServerKey",
      description:
        "A person asks for the key to connect their own server with under this credential name. The hub makes an Ed25519 key pair and answers its public half, to give the hosting provider; the private half is never answered. Until the key is connected, every ask answers the same key, unless fresh asks for a new one. Once one is connected, the next ask makes the key for another server, and the connected one keeps working until that is connected.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ServerKeyIssue) } },
      },
      responses: {
        200: keyState("The key's public half and label, issued"),
        400: personRefusal("Not an ask for a key"),
        403: notAllowed,
        404: personRefusal(
          "No installed plugin declares a server key a person connects under that name",
        ),
        409: personRefusal("The tenant is no project's"),
      },
    }),
    async (c) => {
      const { owner: of, name } = await owner(c);
      const input = ServerKeyIssue(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_issue");
      return c.json(await serverKeys.issue(of, name, input));
    },
  );
  routes.post(
    "/server-keys/:name/bind",
    describeRoute({
      tags: ["Credentials"],
      operationId: "connectServerKey",
      description:
        "A person connects their own server with the key they were given: host is the server's IP address or host name, as their hosting provider shows it. The hub reads the host key the server presents, signs in with the key pinned to it, runs one command that changes nothing, and only then saves the key as the plugin's ssh credential in the project, in place of any key saved under the name before, and forgets its own copy of the private half.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ServerAddress) } },
      },
      responses: {
        200: keyState("The key as now connected, with the server's address"),
        400: personRefusal("Not a server address"),
        403: notAllowed,
        404: personRefusal(
          "No installed plugin declares a server key a person connects under that name",
        ),
        409: personRefusal(
          "The tenant is no project's, or no key is waiting to be connected under this name",
        ),
        422: personRefusal(
          "A loopback or private address, which this hub is not set to reach",
        ),
        502: personRefusal(
          "The server did not answer, or did not accept the key yet: once the key is on the server, asking again succeeds",
        ),
      },
    }),
    async (c) => {
      const { owner: of, name } = await owner(c);
      const input = ServerAddress(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_address");
      return c.json(await serverKeys.connect(of, name, input));
    },
  );
  app.route("/api/tenants/:tenantId", routes);
}
