import { type } from "arktype";
import { Hono } from "hono";
import { html } from "hono/html";
import { describeRoute, resolver } from "hono-openapi";
import type { DB } from "@intx/db";
import {
  createResolveTenant,
  requireAuth,
  type AppEnv,
  type RequireGrant,
  type TenantEnv,
} from "@intx/hub-api";
import {
  PluginSignInDisconnected,
  PluginSignInRefusal,
  PluginSignInStart,
  PluginSignInStarted,
  PluginSignInState,
} from "@corbits-builder/schemas/settings";
import { signInWording } from "../config/sign-in.ts";
import { body, security } from "../http/route-parts.ts";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { SIGN_IN_CALLBACK_PATH, type PluginSignIns } from "./sign-ins.ts";

const refusal = (description: string) => ({
  description,
  content: { "application/json": { schema: resolver(PluginSignInRefusal) } },
});
const state = {
  description: "Where the sign-in stands; never a code or a token",
  content: { "application/json": { schema: resolver(PluginSignInState) } },
};
const notFound = refusal(
  "No sign-in of that id that this person started in this tenant",
);

// The single value of a query parameter. A repeated parameter counts as missing, so the hub never
// picks between two values.
const single = (values: string[] | undefined) =>
  values?.length === 1 ? values[0] : undefined;

/**
 * The plugin sign-in routes: start, follow, cancel and disconnect under the tenant, and the
 * callback at the hub's root that every provider sends the person back to.
 */
export function mountPluginSignIns(
  app: Hono<AppEnv>,
  signIns: PluginSignIns,
  options: { db: DB["db"]; requireGrant: RequireGrant; productName: string },
) {
  const words = signInWording(options.productName);
  const tenantRoutes = new Hono<TenantEnv>();
  // Scoped to these paths: this router is mounted at the tenant root beside other routers.
  for (const path of ["/plugin-sign-ins", "/plugin-sign-ins/*"])
    tenantRoutes.use(
      path,
      requireAuth,
      createResolveTenant({ db: options.db }),
    );
  tenantRoutes.post(
    "/plugin-sign-ins",
    describeRoute({
      tags: ["Credentials"],
      operationId: "startPluginSignIn",
      description:
        "Starts signing in at a plugin's provider for the credential of that name, in a project's tenant. The provider's addresses, the scopes asked for and the hub's client there come from the installed plugin. Opening the answered address in a new tab takes the person to the provider; a sign-in already under way for the same credential in this tenant is replaced.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(PluginSignInStart) },
        },
      },
      responses: {
        200: {
          description: "The sign-in's id and the provider's address to open",
          content: {
            "application/json": { schema: resolver(PluginSignInStarted) },
          },
        },
        400: refusal("No credential name"),
        404: refusal("No installed plugin signs in for that credential"),
        409: refusal(
          "The tenant is a workspace: a sign-in is saved for one project",
        ),
        502: refusal("The provider would not register the hub as a client"),
      },
    }),
    // The sign-in creates or updates the plugin's provider row in the workspace as well as the
    // credential.
    options.requireGrant("provider:*", "create"),
    options.requireGrant("credential:*", "create"),
    async (c) => {
      const input = PluginSignInStart(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_sign_in");
      return c.json(
        await signIns.start(actorOf(c), c.get("user")!.id, input.credential),
      );
    },
  );
  tenantRoutes.post(
    "/plugin-sign-ins/disconnect",
    describeRoute({
      tags: ["Credentials"],
      operationId: "disconnectPluginSignIn",
      description:
        "Signs out of a plugin's provider: revokes the signed-in credential of that name at the provider, when the plugin names where, then revokes it here and takes it out of every running run that holds it. Revoked here even when the provider did not confirm, which the answer says.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(PluginSignInStart) },
        },
      },
      responses: {
        200: {
          description:
            "Revoked here, and whether the provider may still hold the grant",
          content: {
            "application/json": { schema: resolver(PluginSignInDisconnected) },
          },
        },
        400: refusal("No credential name"),
        403: { description: "May not manage the credential" },
        404: refusal(
          "No plugin signs in for that name, or the tenant holds no signed-in credential of it",
        ),
      },
    }),
    async (c) => {
      const input = PluginSignInStart(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_sign_in");
      return c.json(await signIns.disconnect(actorOf(c), input.credential));
    },
  );
  tenantRoutes.get(
    "/plugin-sign-ins/:signInId",
    describeRoute({
      tags: ["Credentials"],
      operationId: "readPluginSignIn",
      description:
        "Where a sign-in this person started in this tenant stands: waiting on the provider, done, or why it failed or was cancelled. It never carries a code or a token.",
      security,
      responses: { 200: state, 404: notFound },
    }),
    (c) => c.json(signIns.state(actorOf(c), c.req.param("signInId"))),
  );
  tenantRoutes.post(
    "/plugin-sign-ins/:signInId/cancel",
    describeRoute({
      tags: ["Credentials"],
      operationId: "cancelPluginSignIn",
      description:
        "Stops waiting for a sign-in: a code the provider sends for it afterwards is not exchanged.",
      security,
      responses: { 200: state, 404: notFound },
    }),
    (c) => c.json(signIns.cancel(actorOf(c), c.req.param("signInId"))),
  );
  app.route("/api/tenants/:tenantId", tenantRoutes);

  app.get(
    SIGN_IN_CALLBACK_PATH,
    describeRoute({
      tags: ["Credentials"],
      operationId: "pluginSignInCallback",
      description:
        "Where a plugin's provider sends the person back after they sign in. The code is exchanged only when the browser is signed in to Builder as the person who started the sign-in. Answers a short page saying whether it worked, never repeating what the address carried.",
      responses: {
        200: { description: "Signed in; the tab can be closed" },
        400: { description: "The sign-in did not finish" },
      },
    }),
    async (c) => {
      const done = await signIns.callback(
        {
          state: single(c.req.queries("state")),
          code: single(c.req.queries("code")),
          error: single(c.req.queries("error")),
        },
        c.get("user")?.id,
      );
      // This address contains the code, so keep it out of caches and the next page's referrer.
      c.header("cache-control", "no-store");
      c.header("referrer-policy", "no-referrer");
      return c.html(
        html`<!doctype html>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${words.title}</title>
          <p>${done ? words.done : words.failed}</p>`,
        done ? 200 : 400,
      );
    },
  );
}
