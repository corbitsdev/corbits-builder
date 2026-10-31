import { productClient } from "./transport.ts";
import { workspaceTenantId } from "./auth.ts";

export async function listDesignThemes(projectId: string) {
  const tenantId = await workspaceTenantId();
  return (await productClient().designThemes(tenantId, projectId)).themes;
}

export async function readDesignTheme(projectId: string, themeId: string) {
  const tenantId = await workspaceTenantId();
  return (await productClient().designTheme(tenantId, projectId, themeId))
    .files;
}
