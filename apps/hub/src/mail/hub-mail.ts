import { and, eq } from "drizzle-orm";
import type { DB } from "@intx/db";
import { principal, user } from "@intx/db/schema";
import type { GetSession } from "@intx/hub-api";
import { readJson } from "../lib/json.ts";

type Session = NonNullable<Awaited<ReturnType<GetSession>>>;

// Run mail is sent as a person, so mail the hub sends outside a person's request goes through the
// native run mail route as the project's person, as an import's opening message does. The session
// belongs to the in-process request the hub built and to no other request.
const hubRequests = new WeakMap<Headers, Session>();

export const hubRequestSession = (headers: Headers): Session | null =>
  hubRequests.get(headers) ?? null;

export class HubMailError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export type HubMail = (args: {
  tenantId: string;
  runId: string;
  principalId: string;
  content: string;
}) => Promise<void>;

export function createHubMail(
  db: DB["db"],
  fetch: (request: Request) => Promise<Response>,
  origin: string,
): HubMail {
  return async ({ tenantId, runId, principalId, content }) => {
    const [sender] = await db
      .select({ user })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.refId))
      .where(and(eq(principal.id, principalId), eq(principal.kind, "user")));
    if (!sender) throw new HubMailError(404, "hub_mail_sender_missing");
    const path = `/api/tenants/${encodeURIComponent(tenantId)}/workflows/runs/${encodeURIComponent(runId)}/mail`;
    const request = new Request(new URL(path, origin).href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const now = new Date();
    hubRequests.set(request.headers, {
      user: sender.user,
      session: {
        id: "hub-mail",
        token: "",
        userId: sender.user.id,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    const response = await fetch(request);
    if (response.ok) return;
    const payload: unknown = await readJson(response);
    const upstream =
      payload !== null && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    throw new HubMailError(
      response.status,
      upstream !== null && typeof upstream === "object" && "code" in upstream
        ? String(upstream.code)
        : `coordinator_mail_${response.status}`,
    );
  };
}
