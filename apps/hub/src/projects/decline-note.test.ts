import { expect, test } from "bun:test";
import { Hono } from "hono";
import { declineNote } from "../config/decline.ts";
import { createDeclineNote } from "./decline-note.ts";

// What Interchange's reject route would receive.
async function rejected(approvalId: string, body: unknown) {
  const app = new Hono();
  app.use(
    "/api/tenants/:tenantId/approvals/:approvalId/reject",
    createDeclineNote({
      coordinatorAsk: async (tenantId, id) =>
        tenantId === "tenant_1" && id === "appr_brief",
    }),
  );
  app.post("/api/tenants/:tenantId/approvals/:approvalId/reject", async (c) =>
    c.json(await c.req.json()),
  );
  const response = await app.request(
    `/api/tenants/tenant_1/approvals/${approvalId}/reject`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return response.json();
}

test("a coordinator ask's decline carries the person's words in the hub's note", async () => {
  expect(
    await rejected("appr_brief", { scope: "once", message: "Make it shorter" }),
  ).toEqual({ scope: "once", message: declineNote("Make it shorter") });
});

test("a coordinator ask's decline without words asks the coordinator to find out what next", async () => {
  expect(await rejected("appr_brief", {})).toEqual({
    message: declineNote(undefined),
  });
});

test("a decline of another run's ask passes through unchanged", async () => {
  expect(await rejected("appr_packages", { message: "Not that one" })).toEqual({
    message: "Not that one",
  });
});

test("a decline whose message Interchange would refuse passes through unchanged", async () => {
  expect(await rejected("appr_brief", { message: 42 })).toEqual({
    message: 42,
  });
});
