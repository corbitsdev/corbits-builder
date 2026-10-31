import { migrateDatabase } from "./migrate.ts";
import { createHubRuntime } from "./app.ts";
import { bootstrapPrincipal, readBootstrapOptions } from "./bootstrap.ts";
import { getLogger } from "@intx/log";
import { setupHubLogging } from "./logging.ts";
import { requestErrorMetadata } from "./request-error.ts";

export async function runSetup() {
  // Validate the operator's explicit bootstrap identity before changing the DB.
  const options = readBootstrapOptions(process.env);
  await setupHubLogging();
  await migrateDatabase();
  const runtime = await createHubRuntime();
  try {
    // Setup goes through the authenticated app routes as any HTTP client would.
    return await bootstrapPrincipal(options, async (url, init) =>
      runtime.app.fetch(new Request(url.toString(), init)),
    );
  } finally {
    await runtime.close();
  }
}

if (import.meta.main) {
  try {
    await runSetup();
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
