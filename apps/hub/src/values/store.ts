import { type } from "arktype";
import { eq, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  getArtifactVersion,
  listArtifacts,
  type ArtifactDb,
} from "@corbits/artifacts";
import type { DB } from "@intx/db";
import {
  STACK_VALUES,
  starterValues,
  type AppStarter,
} from "@corbits-builder/plugin";
import { AppVersionMetadata } from "@corbits-builder/schemas/artifact";
import { project } from "../db/schema.ts";
import { CATALOG } from "../plugins/catalog.ts";

/** Where a project's values are kept: what it stores, how its code began, and adding to it. */
export type ValueStore = {
  read(): Promise<Readonly<Record<string, unknown>>>;
  code(): Promise<"none" | "built" | "imported" | "unknown">;
  add(
    values: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>>;
};

export function codeProvenance(metadata: unknown) {
  const first = AppVersionMetadata(metadata);
  if (first instanceof type.errors) return "unknown";
  return first.source === "import" ? "imported" : "built";
}

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
    // The app's first version says how its code began: a person's import, or a coder's build
    // (versions filed before sources were recorded came from builds or imports alike).
    async code() {
      const [app] = (
        await listArtifacts(artifacts, tenantId, { kind: "app", limit: 1 })
      ).rows;
      if (!app) return "none";
      return codeProvenance(
        (await getArtifactVersion(artifacts, app.id, 1))?.metadata,
      );
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
 * The project's stored values, the one way they are read. A project a coder built with none of the
 * values that record how its code started was built before projects recorded them, from the starter
 * an installed plugin marks as the legacy default: it gets that starter's values, saved on this
 * first read. Projects that recorded their starter before projects recorded how their code runs in
 * production get that starter's production the same way, if the starter declares one. Imported
 * code and code of unknown origin get none; their first coder establishes and reports them as a
 * build from no starter does.
 */
export async function readStoredValues(
  store: ValueStore,
  legacy = CATALOG.legacyStarter,
  starters: ReadonlyMap<string, AppStarter> = CATALOG.appStarters,
) {
  const stored = await store.read();
  if (STACK_VALUES.some((name) => Object.hasOwn(stored, name))) {
    const name = stored["stack.starter"];
    const production =
      typeof name === "string" ? starters.get(name)?.production : undefined;
    if (Object.hasOwn(stored, "stack.production") || production === undefined)
      return stored;
    return store.add({ "stack.production": production });
  }
  if (legacy === undefined || (await store.code()) !== "built") return stored;
  return store.add(starterValues(legacy));
}
