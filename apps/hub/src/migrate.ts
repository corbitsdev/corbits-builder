import { fileURLToPath } from "node:url";
import { runAgentTokenMigrations } from "@corbits/agent-token/migrations";
import { runArtifactMigrations } from "@corbits/artifacts";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  readMigrationEnvironment,
  type MigrationEnvironment,
} from "./environment.ts";
import { migrateProductDatabase } from "./db/migrate.ts";
import { errorCode } from "./request-error.ts";

const migrationsFolder = fileURLToPath(
  new URL("../migrations/", import.meta.resolve("@intx/db")),
);

export async function migrateDatabase(
  environment: Pick<MigrationEnvironment, "migrationDatabase">,
): Promise<void> {
  const config = environment.migrationDatabase;
  const client = postgres({
    ...config,
    max: 1,
    connection: { search_path: "public" },
    onnotice: () => undefined,
  });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    await runArtifactMigrations(config, { schema: "public" });
    await runAgentTokenMigrations(config, { schema: "public" });
    await migrateProductDatabase(db);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const environment = readMigrationEnvironment();
  try {
    await migrateDatabase(environment);
    console.log(JSON.stringify({ migrationsApplied: true }));
  } catch (error) {
    // The message can carry the database URL; the code, such as a SQLSTATE, cannot.
    console.error(
      JSON.stringify({ migrationsApplied: false, ...errorCode(error) }),
    );
    process.exitCode = 1;
  }
}
