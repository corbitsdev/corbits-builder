import { createHash, timingSafeEqual } from "node:crypto";
import { type } from "arktype";
import type { SidecarProvisioner } from "@intx/hub-sessions";
import { AdapterManifest } from "@intx/types";

const MIN_TOKEN_LENGTH = 32;
/** Carries the binding the hub registered, so a service restarted with another Docker setup refuses its calls. */
export const BINDING_HEADER = "x-sidecar-binding";

const Identity = {
  allocationId: "string > 0",
  generation: "number.integer >= 0",
  sidecarId: "string > 0",
} as const;
const EnsureBody = type({
  ...Identity,
  tenantId: "string > 0",
  anchorRunId: "string > 0",
  token: "string > 0",
  hubWebSocketUrl: "string > 0",
  "adapterManifest?": AdapterManifest,
});
const DestroyBody = type({ ...Identity, "externalRef?": "string" });

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The secret the hub and the service share, checked wherever either reads it. */
export function provisionerToken(token: string | undefined): string {
  if (!token) throw new Error("SIDECAR_PROVISIONER_TOKEN is required");
  if (token.length < MIN_TOKEN_LENGTH)
    throw new Error(
      `SIDECAR_PROVISIONER_TOKEN must be at least ${String(MIN_TOKEN_LENGTH)} characters; generate one with \`openssl rand -hex 32\``,
    );
  return token;
}

async function readBody<T>(
  request: Request,
  schema: (data: unknown) => T | type.errors,
): Promise<T | Response> {
  let data: unknown;
  try {
    data = await request.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return Response.json({ error: "Body is not JSON" }, { status: 400 });
  }
  const body = schema(data);
  if (body instanceof type.errors)
    return Response.json({ error: body.summary }, { status: 400 });
  return body;
}

/**
 * The hub's provisioner calls over HTTP. `GET /binding` answers the provisioner's binding fingerprint and
 * capabilities; `POST /ensure` and `POST /destroy` take the Interchange request without its signal and answer its
 * result. A dropped hub connection aborts the call, as the hub's signal would.
 */
export function createProvisionerRoutes({
  provisioner,
  token,
}: {
  readonly provisioner: SidecarProvisioner;
  /** The secret the hub sends as its bearer token. */
  readonly token: string;
}) {
  const expected = digest(`Bearer ${provisionerToken(token)}`);
  function authorized(request: Request): boolean {
    const authorization = request.headers.get("authorization");
    return (
      authorization !== null && timingSafeEqual(digest(authorization), expected)
    );
  }
  function refusal(request: Request): Response | undefined {
    if (!authorized(request)) return new Response(null, { status: 401 });
    if (request.headers.get(BINDING_HEADER) !== provisioner.bindingFingerprint)
      return new Response(null, { status: 409 });
    return undefined;
  }

  function binding(request: Request): Response {
    if (!authorized(request)) return new Response(null, { status: 401 });
    return Response.json({
      bindingFingerprint: provisioner.bindingFingerprint,
      capabilities: provisioner.capabilities,
    });
  }

  async function ensure(request: Request): Promise<Response> {
    const refused = refusal(request);
    if (refused) return refused;
    const body = await readBody(request, EnsureBody);
    if (body instanceof Response) return body;
    return Response.json(
      await provisioner.ensure({ ...body, signal: request.signal }),
    );
  }

  async function destroy(request: Request): Promise<Response> {
    const refused = refusal(request);
    if (refused) return refused;
    const body = await readBody(request, DestroyBody);
    if (body instanceof Response) return body;
    return Response.json(
      await provisioner.destroy({ ...body, signal: request.signal }),
    );
  }

  return {
    "/binding": { GET: binding },
    "/ensure": { POST: ensure },
    "/destroy": { POST: destroy },
  };
}
