import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type } from "arktype";
import type { AuthMethods } from "./auth.ts";

const AuthMethodsResponse = type({
  google: "boolean",
  emailPassword: "boolean",
  magicLink: "boolean",
  passwordReset: "boolean",
  verificationEmail: "boolean",
});

// The sign-in surface asks this once, so it never offers a method the hub
// cannot actually complete (no SMTP, no Google credentials).
export function createAuthMethodsRoutes(methods: AuthMethods) {
  const routes = new Hono();
  routes.get(
    "/auth-methods",
    describeRoute({
      tags: ["Authentication"],
      operationId: "listAuthMethods",
      description: "Which sign-in methods this hub can complete.",
      responses: {
        200: {
          description: "Available sign-in methods.",
          content: {
            "application/json": { schema: resolver(AuthMethodsResponse) },
          },
        },
      },
    }),
    (c) => c.json(methods, { headers: { "cache-control": "no-store" } }),
  );
  return routes;
}
