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
  const stop = () =>
    (stopping ??= (async () => {
      for (const step of [close, dispose]) {
        try {
          await step();
        } catch (error) {
          log.error("Hub shutdown failed", errorMetadata(error));
          process.exitCode = 1;
        }
      }
    })());
  const exitOnFatal = (message: string) => async (error: unknown) => {
    try {
      log.error(message, errorMetadata(error));
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
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
  try {
    const runtime = await createHubRuntime();
    const server = Bun.serve({
      hostname: runtime.hostname,
      port: runtime.port,
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
  } catch (error) {
    log.error(
      "Hub startup failed; check environment and database readiness",
      errorMetadata(error),
    );
    process.exitCode = 1;
    await stop();
  }
}
