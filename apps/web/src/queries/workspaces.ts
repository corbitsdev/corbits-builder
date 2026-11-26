import { listWorkspaces, workspaceTenantId } from "../api/auth.ts";
import { keys } from "./keys.ts";

/** The person's workspaces and which one is open, whose name heads the sidebar outside a project. */
export const workspacesQuery = {
  queryKey: keys.workspaces,
  queryFn: async () => ({
    list: await listWorkspaces(),
    openId: await workspaceTenantId(),
  }),
};
