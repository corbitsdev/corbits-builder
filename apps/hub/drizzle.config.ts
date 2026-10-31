import { defineConfig } from "drizzle-kit";

// Product snapshots contain product tables only. Platform migrations run first
// and own the referenced tenant/principal tables independently.
export default defineConfig({
  dialect: "postgresql",
  schema: "./apps/hub/src/db/schema.ts",
  out: "./apps/hub/src/db/migrations",
});
