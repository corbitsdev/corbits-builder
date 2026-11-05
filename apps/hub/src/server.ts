import { getLogger } from "@intx/log";
import { dispose } from "@logtape/logtape";
import { createHubRuntime } from "./app.ts";
import { setupHubLogging } from "./logging.ts";
import { errorCode, requestErrorMetadata } from "./request-error.ts";

const errorMetadata = (error: unknown) => ({
  ...errorCode(error),
  ...requestErrorMetadata(error),
});

if (import.meta.main) {
  await setupHubLogging();
  const log = getLogger(["corbits-builder", "hub"]);
  let close = async () => {};
  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  let startupDone = false;
  const shutDown = async () => {
    for (const step of [close, dispose]) {
      try {
        await step();
      } catch (error) {
        log.error("Hub shutdown failed", errorMetadata(error));
        process.exitCode = 1;
      }
    }
  };
  const stop = () => (stopping ??= shutDown());
  const exitOnFatal = (message: string) => async (error: unknown) => {
    try {
      log.error(message, errorMetadata(error));
      // Unlike a signal, this does not wait for startup: a startup stuck on the failure would keep the hub up instead of letting its supervisor restart it.
      await stop();
    } finally {
      // Handles a failed shutdown left open would keep a broken hub alive instead of letting its supervisor restart it.
      process.exit(1);
    }
  };
  process.on(
    "unhandledRejection",
    exitOnFatal("Hub hit an unhandled rejection"),
  );
  process.on("uncaughtException", exitOnFatal("Hub hit an uncaught exception"));
  // Startup takes seconds; a stop meanwhile is recorded and acted on when startup finishes, so it closes what startup opened.
  const requestStop = () => {
    stopRequested = true;
    if (startupDone) void stop();
  };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);
  const start = async () => {
    const runtime = await createHubRuntime();
    close = () => runtime.close();
    // A stop requested meanwhile must not open the port; the stop after startup closes the runtime.
    if (stopRequested) return;
    const server = Bun.serve({
      hostname: runtime.hostname,
      port: runtime.port,
      // Bun's 10-second default drops slow routes; the run stream's 5-second heartbeat stays well inside this.
      idleTimeout: 120,
      fetch: runtime.app.fetch,
      websocket: runtime.websocket,
    });
    close = async () => {
      await server.stop(true);
      await runtime.close();
    };
    await runtime.start();
    log.info(
      "Hub ready: Postgres connected; local Interchange sidecar provisioner",
    );
  };
  try {
    await start();
  } catch (error) {
    log.error(
      "Hub startup failed; check environment and database readiness",
      errorMetadata(error),
    );
    process.exitCode = 1;
    await stop();
  }
  startupDone = true;
  if (stopRequested) await stop();
}
