import { fileURLToPath } from "node:url";
import { runAgentTokenMigrations } from "@corbits/agent-token/migrations";
import { runArtifactMigrations } from "@corbits/artifacts";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  readMigrationDatabaseConfig,
  type Environment,
} from "./environment.ts";
import { migrateProductDatabase } from "./db/migrate.ts";

const migrationsFolder = fileURLToPath(
  new URL("../migrations/", import.meta.resolve("@intx/db")),
);

export async function migrateDatabase(
  env: Environment = process.env,
): Promise<void> {
  const config = readMigrationDatabaseConfig(env);
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
  try {
    await migrateDatabase();
    console.log(JSON.stringify({ migrationsApplied: true }));
  } catch {
    console.error(JSON.stringify({ migrationsApplied: false }));
    process.exitCode = 1;
  }
}
