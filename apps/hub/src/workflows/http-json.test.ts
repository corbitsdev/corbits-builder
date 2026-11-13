import { expect, test } from "bun:test";
import type { HttpMediatedCredential } from "@intx/types";
import { mediatedHttpJson, WorkflowHttpError } from "./http-json.ts";

const call = (fetch: HttpMediatedCredential["fetch"]) =>
  mediatedHttpJson({
    credential: { kind: "http", fetch, dispose: () => undefined },
    path: "/api/tenants/t/projects/p/design-draft/previous",
    maxResponseBytes: 1024,
    signal: new AbortController().signal,
  });

test("a hub refusal reaches the agent as the hub's code and why", async () => {
  const refusal = call(async () =>
    Response.json(
      {
        code: "design_draft_too_large",
        bytes: 2_000_000,
        hint: "The draft cannot be loaded: the design is 1953 KB.",
      },
      { status: 409 },
    ),
  );
  await expect(refusal).rejects.toThrow(
    "design_draft_too_large: The draft cannot be loaded: the design is 1953 KB.",
  );
  await expect(refusal).rejects.toMatchObject({ refused: true });
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
  ).rejects.toThrow(
    "invalid_artifact_write: the hub refused the call (HTTP 400); content must be a design bundle",
  );
});

test("a hub that failed or could not be reached is unavailable, not a refusal", async () => {
  const failed = call(async () =>
    Response.json({ error: "internal_error" }, { status: 503 }),
  );
  await expect(failed).rejects.toThrow("workflow_http_unavailable:http_503");
  await expect(failed).rejects.toMatchObject({ refused: false });
  const unreachable = call(async () => {
    throw new TypeError("Unable to connect");
  });
  await expect(unreachable).rejects.toThrow(
    "workflow_http_unavailable:unreachable",
  );
  await expect(unreachable).rejects.toBeInstanceOf(WorkflowHttpError);
});
