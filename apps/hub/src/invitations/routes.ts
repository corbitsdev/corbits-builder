import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  createResolveTenant,
  requireAuth,
  type TenantEnv,
  type AppEnv,
} from "@intx/hub-api";
import type { DB, PrincipalKeyStore } from "@intx/db";
import {
  CreateInvitation,
  Invitation,
  InvitationCreation,
  InvitationDeliveryFailure,
  InvitationList,
} from "@corbits-builder/schemas/invitation";
import { isDeviceSession } from "../auth.ts";
import { ProjectError } from "../projects/errors.ts";
import { createInvitationService } from "./service.ts";

export function invitationSessionGuard(
  isDevice: (id: string) => Promise<boolean>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header("cache-control", "no-store");
    const person = c.get("user");
    const session = c.get("session");
    if (
      !person ||
      !session ||
      session.userId !== person.id ||
      (await isDevice(session.id))
    )
      throw new ProjectError(403, "human_session_required");
    if (
      c.req.method === "POST" &&
      c.req.header("content-type")?.split(";", 1)[0]?.trim() !==
        "application/json"
    )
      throw new ProjectError(400, "json_body_required");
    await next();
  };
}

export function createInvitationRoutes(options: {
  db: DB["db"];
  principalKeyStore: PrincipalKeyStore;
  publicURL: URL;
  notify?:
    | ((email: string, path: string, expiresAt: string) => Promise<void>)
    | undefined;
}) {
  const service = createInvitationService(
    options.db,
    options.principalKeyStore,
  );
  const session = invitationSessionGuard((id) =>
    isDeviceSession(options.db, id),
  );
  const management = new Hono<TenantEnv>();
  management.use(
    "*",
    requireAuth,
    createResolveTenant({ db: options.db }),
    session,
  );
  management.use(
    "*",
    bodyLimit({
      maxSize: 8192,
      onError: (c) => c.json({ code: "invitation_request_too_large" }, 413),
    }),
  );
  const responseSchema = {
    description: "Invitation lifecycle; no login token or implicit activation",
    content: { "application/json": { schema: resolver(Invitation) } },
  };
  management.get(
    "/",
    describeRoute({
      tags: ["Invitations"],
      operationId: "listInvitations",
      responses: {
        200: {
          description: "At most 100 most recent tenant invitations",
          content: { "application/json": { schema: resolver(InvitationList) } },
        },
      },
    }),
    async (c) =>
      c.json(
        await service.list({
          tenantId: c.get("tenant").id,
          principalId: c.get("principal").id,
          userId: c.get("user")!.id,
        }),
      ),
  );
  management.post(
    "/",
    describeRoute({
      tags: ["Invitations"],
      operationId: "createInvitation",
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(CreateInvitation) } },
      },
      responses: {
        200: {
          description:
            "Existing invitation for this idempotency key; email not resent",
          content: {
            "application/json": { schema: resolver(InvitationCreation) },
          },
        },
        201: {
          description: "Pending invitation saved with explicit delivery status",
          content: {
            "application/json": { schema: resolver(InvitationCreation) },
          },
        },
        502: {
          description: "Invitation saved; notification failed",
          content: {
            "application/json": { schema: resolver(InvitationDeliveryFailure) },
          },
        },
      },
    }),
    async (c) => {
      let input: unknown;
      try {
        input = await c.req.json();
      } catch {
        throw new ProjectError(400, "invalid_invitation");
      }
      const result = await service.create(
        {
          tenantId: c.get("tenant").id,
          principalId: c.get("principal").id,
          userId: c.get("user")!.id,
        },
        input,
      );
      const path = `/api/invitations/${encodeURIComponent(result.invitation.id)}`;
      const body = { invitation: result.invitation, invitationPath: path };
      if (!result.created)
        return c.json({ ...body, delivery: "not_attempted" }, 200);
      if (!options.notify)
        return c.json({ ...body, delivery: "unconfigured" }, 201);
      try {
        await options.notify(
          result.invitation.email,
          new URL(path, options.publicURL).href,
          result.invitation.expiresAt,
        );
      } catch {
        return c.json(
          {
            ...body,
            delivery: "failed",
            code: "invitation_email_delivery_failed",
          },
          502,
        );
      }
      return c.json({ ...body, delivery: "sent" }, 201);
    },
  );
  management.post(
    "/:invitationId/revoke",
    describeRoute({
      tags: ["Invitations"],
      operationId: "revokeInvitation",
      responses: { 200: responseSchema },
    }),
    async (c) =>
      c.json(
        await service.revoke(
          {
            tenantId: c.get("tenant").id,
            principalId: c.get("principal").id,
            userId: c.get("user")!.id,
          },
          c.req.param("invitationId"),
        ),
      ),
  );

  // A pending recipient has no tenant membership yet. Resolve the session here,
  // then let the service match the verified email before disclosing tenant data.
  const recipient = new Hono<AppEnv>();
  recipient.use("*", requireAuth, session);
  recipient.use(
    "*",
    bodyLimit({
      maxSize: 1024,
      onError: (c) => c.json({ code: "invitation_request_too_large" }, 413),
    }),
  );
  recipient.get(
    "/:invitationId",
    describeRoute({
      tags: ["Invitations"],
      operationId: "readInvitation",
      responses: { 200: responseSchema },
    }),
    async (c) =>
      c.json(
        await service.readForRecipient(
          c.req.param("invitationId"),
          c.get("user")!.id,
        ),
      ),
  );
  recipient.post(
    "/:invitationId/accept",
    describeRoute({
      tags: ["Invitations"],
      operationId: "acceptInvitation",
      responses: { 200: responseSchema },
    }),
    async (c) =>
      c.json(
        await service.accept(c.req.param("invitationId"), c.get("user")!.id),
      ),
  );
  return { management, recipient };
}
