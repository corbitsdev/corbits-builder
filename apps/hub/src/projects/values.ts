import { eq, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { listArtifacts, type ArtifactDb } from "@corbits/artifacts";
import type { DB } from "@intx/db";
import { STACK_VALUES, starterValues } from "@corbits-builder/plugin";
import { project } from "../db/schema.ts";
import { CATALOG } from "../plugins/catalog.ts";

/** Where a project's values are kept: what it stores, whether it has code, and adding to it. */
export type ValueStore = {
  read(): Promise<Readonly<Record<string, unknown>>>;
  hasCode(): Promise<boolean>;
  add(
    values: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
};

/** A project's values as the database keeps them; its code is the app filed in its tenant. */
export function projectValueStore(
  db: DB["db"],
  tenantId: string,
  projectId: string,
): ValueStore {
  if (!(db instanceof PostgresJsDatabase))
    throw new Error("Project values require postgres-js");
  const artifacts: ArtifactDb = db;
  return {
    async read() {
      const [row] = await db
        .select({ values: project.values })
        .from(project)
        .where(eq(project.id, projectId));
      return row?.values ?? {};
    },
    async hasCode() {
      const { rows } = await listArtifacts(artifacts, tenantId, {
        kind: "app",
        limit: 1,
      });
      return rows.length > 0;
    },
    async add(values) {
      const [row] = await db
        .update(project)
        .set({
          values: sql`${project.values} || ${JSON.stringify(values)}::jsonb`,
        })
        .where(eq(project.id, projectId))
        .returning({ values: project.values });
      return row?.values ?? {};
    },
  };
}

/**
 * The project's stored values, the one way they are read. A project with code but none of the
 * values that record how its code started was built before projects recorded them, from the starter
 * an installed plugin marks as the legacy default: it gets that starter's values, saved on this
 * first read.
 */
export async function readStoredValues(
  store: ValueStore,
  legacy = CATALOG.legacyStarter,
) {
  const stored = await store.read();
  if (
    legacy === undefined ||
    STACK_VALUES.some((name) => Object.hasOwn(stored, name)) ||
    !(await store.hasCode())
  )
    return stored;
  return store.add(starterValues(legacy));
}
