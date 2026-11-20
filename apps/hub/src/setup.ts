import { migrateDatabase } from "./migrate.ts";
import { createHubRuntime } from "./app.ts";
import { bootstrapPrincipal } from "./bootstrap.ts";
import { readSetupEnvironment, type SetupEnvironment } from "./environment.ts";
import { getLogger } from "@intx/log";
import { setupHubLogging } from "./logging.ts";
import { requestErrorMetadata } from "./request-error.ts";

export async function runSetup(environment: SetupEnvironment) {
  await setupHubLogging(environment);
  await migrateDatabase(environment);
  const runtime = await createHubRuntime(environment);
  try {
    // Setup goes through the authenticated app routes as any HTTP client would.
    return await bootstrapPrincipal(environment.bootstrap, async (url, init) =>
      runtime.app.fetch(new Request(url.toString(), init)),
    );
  } finally {
    await runtime.close();
  }
}

if (import.meta.main) {
  // The operator's explicit bootstrap identity is checked with the rest before the DB changes.
  const environment = readSetupEnvironment();
  try {
    await runSetup(environment);
    console.log(
      JSON.stringify({
        setupReady: true,
        authenticated: true,
        principalReady: true,
      }),
    );
  } catch (error) {
    getLogger(["corbits-builder", "hub", "setup"]).warn(
      "Setup failed",
      requestErrorMetadata(error),
    );
    console.error(JSON.stringify({ setupReady: false }));
    process.exitCode = 1;
  }
}
