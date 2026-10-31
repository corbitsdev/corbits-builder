import type { Env, Hono } from "hono";
import { openAPIRouteHandler, type GenerateSpecOptions } from "hono-openapi";
import type { ProductConfig } from "./config/index.ts";

export type HubOpenAPIOptions = {
  config: Pick<ProductConfig, "naming">;
  version: string;
  securitySchemes?: NonNullable<
    GenerateSpecOptions["documentation"]["components"]
  >["securitySchemes"];
};

/** Mount after the hub and product routes, before serving the first request. */
export function mountHubOpenAPI<E extends Env>(
  app: Hono<E>,
  options: HubOpenAPIOptions,
): void {
  app.get(
    "/openapi.json",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: options.config.naming.productName,
          version: options.version,
        },
        ...(options.securitySchemes
          ? { components: { securitySchemes: options.securitySchemes } }
          : {}),
      },
      // The delegated auth wildcard (including the device-code operations it
      // serves) has no operation-level metadata. Expanding it would advertise
      // methods and endpoints the app has not described.
      exclude: ["/openapi.json", /^\/api\/auth\//],
    }),
  );
}
