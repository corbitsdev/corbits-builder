import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { createArtifactService } from "../artifacts/service.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { CATALOG, isSelection, selectionRefusal } from "../plugins/catalog.ts";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { projectValueWrites } from "./project-values.ts";
import type { createValueService } from "./service.ts";

export const undeclaredValue = (names: readonly string[]) =>
  names.find((name) => !CATALOG.values.has(name));

// The one way project values are saved, from the values route or a screen's answer: each name
// one the catalog declares, a value whose home is the design's styles written as a design token
// once a design is filed, the rest stored. Only a person selects which of the plugins sharing a handle the project uses.
export async function saveValues(
  c: Context<TenantEnv>,
  projectId: string,
  values: Readonly<Record<string, unknown>>,
  service: Pick<
    ReturnType<typeof createArtifactService>,
    "projectState" | "saveStyleTokens"
  >,
  valuesService: Pick<
    ReturnType<typeof createValueService>,
    "saveStoredValues"
  >,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  const current = actorOf(c);
  const unknown = undeclaredValue(Object.keys(values));
  if (unknown !== undefined)
    throw new ProjectError(400, "unknown_project_value", { key: unknown });
  for (const [name, value] of Object.entries(values)) {
    if (!isSelection(name)) continue;
    if (c.get("principal")?.kind !== "user")
      throw new ProjectError(403, "plugin_selection_person_only", {
        key: name,
      });
    const refused = selectionRefusal(name, value);
    if (refused !== undefined)
      throw new ProjectError(400, "invalid_project_value", {
        key: name,
        issues: [{ path: name, message: refused }],
      });
  }
  const { tokens, stored } = projectValueWrites(
    values,
    await service.projectState(current, projectId),
    CATALOG.values,
  );
  // The tokens first, so a design that cannot take them refuses before anything is stored.
  if (Object.keys(tokens).length > 0)
    await service.saveStyleTokens(
      current,
      projectId,
      tokens,
      (runId, content) =>
        mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
    );
  if (Object.keys(stored).length > 0)
    await valuesService.saveStoredValues(current, projectId, stored);
}
