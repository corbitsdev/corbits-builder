import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  createResolveTenant,
  requireAuth,
  type TenantEnv,
} from "@intx/hub-api";
import type { DB } from "@intx/db";
import type { createProductConfig } from "./config/index.ts";

export function createProductRoutes(
  db: DB["db"],
  config: ReturnType<typeof createProductConfig>,
) {
  const product = new Hono<TenantEnv>();
  product.use("*", requireAuth, createResolveTenant({ db }));
  product.get(
    "/hello",
    describeRoute({
      tags: ["Product"],
      operationId: "productHello",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Authenticated greeting",
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: [
                  "productName",
                  "message",
                  "configuredNaming",
                  "principalId",
                  "tenantId",
                  "authenticated",
                ],
                properties: {
                  productName: { type: "string" },
                  message: { type: "string" },
                  configuredNaming: { type: "boolean" },
                  principalId: { type: "string" },
                  tenantId: { type: "string" },
                  authenticated: { type: "boolean", const: true },
                },
              },
            },
          },
        },
        401: { description: "Authentication required" },
        403: { description: "Active tenant principal required" },
        404: { description: "Tenant not found" },
      },
    }),
    (c) =>
      c.json({
        productName: config.naming.productName,
        message: config.wording.hello,
        configuredNaming: config.features.configuredNaming,
        principalId: c.get("principal").id,
        tenantId: c.get("tenant").id,
        authenticated: true,
      }),
  );
  return product;
}
