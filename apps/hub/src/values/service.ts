import { eq, sql } from "drizzle-orm";
import type { DB } from "@intx/db";
import { project } from "../db/schema.ts";
import type { Actor } from "../lib/actor.ts";
import { authorizeProject } from "../projects/authorization.ts";

// The one write into the project's plain store of values, each replacing the one of its name.
export const storeValues = (
  rawDB: DB["db"],
  projectId: string,
  values: Record<string, unknown>,
) =>
  rawDB
    .update(project)
    .set({
      values: sql`${project.values} || ${JSON.stringify(values)}::jsonb`,
    })
    .where(eq(project.id, projectId));

export function createValueService(rawDB: DB["db"]) {
  return {
    // Merges values into the project's plain store, each replacing the one of its name.
    async saveStoredValues(
      actor: Actor,
      projectId: string,
      values: Record<string, unknown>,
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      await storeValues(rawDB, projectId, values);
    },

    async saveRunValues(
      actor: Actor,
      projectId: string,
      values: Record<string, unknown>,
    ) {
      await authorizeProject(rawDB, actor, projectId, "read");
      await storeValues(rawDB, projectId, values);
    },
  };
}
