import { expect, test } from "bun:test";
import type { HttpMediatedCredential } from "@intx/types";
import { mediatedHttpJson, WorkflowHttpError } from "./http-json.ts";

const call = (
  fetch: HttpMediatedCredential["fetch"],
  signal = new AbortController().signal,
) =>
  mediatedHttpJson({
    credential: { kind: "http", fetch, dispose: () => undefined },
    path: "/api/tenants/t/projects/p/design-draft/previous",
    maxResponseBytes: 1024,
    signal,
  });

test("a hub refusal reaches the agent as the hub's code and why", async () => {
  const refusal = call(async () =>
    Response.json(
      {
        code: "design_draft_too_large",
        privateDetail: "must not reach the agent",
        hint: "The draft cannot be loaded: the design is 1953 KB.",
      },
      { status: 409 },
    ),
  );
  await expect(refusal).rejects.toMatchObject({
    message:
      "design_draft_too_large: The draft cannot be loaded: the design is 1953 KB.",
  });
});

test("a refusal without a hint names its code, status and field issues", async () => {
  await expect(
    call(async () =>
      Response.json(
        {
          code: "invalid_artifact_write",
          issues: [{ path: "content", message: "must be a design bundle" }],
        },
        { status: 400 },
      ),
    ),
  ).rejects.toMatchObject({
    message:
      "invalid_artifact_write: the hub refused the call (HTTP 400); content must be a design bundle",
  });
});

test("a hub that failed or could not be reached is unavailable, not a refusal", async () => {
  const failed = call(async () =>
    Response.json({ error: "internal_error" }, { status: 503 }),
  );
  await expect(failed).rejects.toMatchObject({
    message: "workflow_http_unavailable:http_503",
  });
  const unreachable = call(async () => {
    throw new TypeError("Unable to connect");
  });
  await expect(unreachable).rejects.toMatchObject({
    message: "workflow_http_unavailable:unreachable",
  });
  await expect(unreachable).rejects.toBeInstanceOf(WorkflowHttpError);
});

test("caller cancellation is preserved rather than reported as a hub outage", async () => {
  const canceled = new Error("caller canceled");
  const signal = AbortSignal.abort(canceled);
  await expect(
    call(async () => {
      throw canceled;
    }, signal),
  ).rejects.toBe(canceled);
});
