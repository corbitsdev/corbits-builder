import { getLogger } from "@intx/log";
import { dispose } from "@logtape/logtape";
import { createHubRuntime } from "./app.ts";
import { setupHubLogging } from "./logging.ts";

if (import.meta.main) {
  await setupHubLogging();
  const log = getLogger(["corbits-builder", "hub"]);
  try {
    const runtime = await createHubRuntime();
    const server = Bun.serve({
      hostname: runtime.hostname,
      port: runtime.port,
      // Bun's 10-second default drops slow routes; the run stream's 5-second heartbeat stays well inside this.
      idleTimeout: 120,
      fetch: runtime.app.fetch,
      websocket: runtime.websocket,
    });
    await runtime.start();
    log.info(
      "Hub ready: Postgres connected; local Interchange sidecar provisioner",
    );
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await server.stop(true);
      await runtime.close();
      await dispose();
    };
    process.once("SIGTERM", () => {
      void stop();
    });
    process.once("SIGINT", () => {
      void stop();
    });
  } catch (error) {
    log.error("Hub startup failed; check environment and database readiness", {
      error,
    });
    process.exitCode = 1;
  }
}
