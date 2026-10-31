import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { ProjectError } from "../projects/errors.ts";
import { readJson } from "../lib/json.ts";

// Mail the hub sends on the person's behalf goes through the native run mail route with the
// person's own credentials, exactly as the UI sends a message.
export async function mailRunAsCaller(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  tenantId: string,
  runId: string,
  content: string,
  attachments?: readonly { name: string; mimeType: string; data: string }[],
): Promise<void> {
  if (!nativeFetch) throw new ProjectError(503, "run_mail_unavailable");
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["cookie", "authorization"]) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const path = `/api/tenants/${encodeURIComponent(tenantId)}/workflows/runs/${encodeURIComponent(runId)}/mail`;
  const response = await nativeFetch(
    new Request(new URL(path, c.req.url).href, {
      method: "POST",
      headers,
      body: JSON.stringify(
        attachments ? { content, attachments } : { content },
      ),
    }),
  );
  if (response.ok) return;
  const payload: unknown = await readJson(response);
  const upstream =
    payload !== null && typeof payload === "object" && "error" in payload
      ? payload.error
      : null;
  const status =
    ([400, 403, 404, 409] as const).find(
      (known) => known === response.status,
    ) ?? 503;
  throw new ProjectError(
    status,
    upstream !== null && typeof upstream === "object" && "code" in upstream
      ? String(upstream.code)
      : `run_mail_${response.status}`,
  );
}
