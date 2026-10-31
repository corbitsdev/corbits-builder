import { fileURLToPath } from "node:url";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const productMigrationsFolder = fileURLToPath(
  new URL("./migrations/", import.meta.url),
);

export async function migrateProductDatabase(
  db: PostgresJsDatabase,
): Promise<void> {
  // An independent journal lets product and immutable platform migrations
  // advance independently without editing either migration stream.
  await migrate(db, {
    migrationsFolder: productMigrationsFolder,
    migrationsSchema: "public",
    migrationsTable: "_sb_migrations",
  });
}
