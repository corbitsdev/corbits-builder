import {
  configure,
  getConsoleSink,
  getJsonLinesFormatter,
  getLogger,
} from "@logtape/logtape";
import { dockerProvisionerFromEnv } from "./docker.ts";
import { createProvisionerRoutes, provisionerToken } from "./routes.ts";

await configure({
  sinks: { console: getConsoleSink({ formatter: getJsonLinesFormatter() }) },
  loggers: [
    { category: [], lowestLevel: "info", sinks: ["console"] },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});
const log = getLogger(["corbits-builder", "sidecar-provisioner"]);

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

const token = provisionerToken(process.env["SIDECAR_PROVISIONER_TOKEN"]);
const provisioner = await dockerProvisionerFromEnv(process.env, {
  hubId: required("SIDECAR_DOCKER_HUB_ID"),
});

const server = Bun.serve({
  hostname: required("HOST"),
  port: Number(required("PORT")),
  routes: createProvisionerRoutes({ provisioner, token }),
  fetch: () => new Response(null, { status: 404 }),
  // Docker errors leave out response bodies, so their messages are safe to log and return.
  error(error) {
    log.error("Sidecar provisioner request failed: {message}", {
      message: error.message,
    });
    return Response.json({ error: error.message }, { status: 500 });
  },
});
log.info("Sidecar provisioner listening on {url}", { url: server.url.href });
