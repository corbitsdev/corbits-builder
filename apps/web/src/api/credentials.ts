import { productClient } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";

export async function setCredential(input: {
  plugin: string;
  secret: string;
  baseURL?: string;
  label?: string;
}) {
  const tenantId = await workspaceTenantId();
  return productClient().addModelCredential(tenantId, input);
}
