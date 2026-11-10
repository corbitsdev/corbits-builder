import { productClient } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";

/** Stores one API key for the open workspace. The secret is sent once and never returned. */
export async function setCredential(input: {
  plugin: string;
  secret: string;
  baseURL?: string;
  label?: string;
}) {
  const tenantId = await workspaceTenantId();
  return productClient().addModelCredential(tenantId, input);
}
