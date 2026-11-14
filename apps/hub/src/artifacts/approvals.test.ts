import { expect, test } from "bun:test";
import { carriedApproval } from "./approvals.ts";

const asked = {
  requestedBy: "person-1",
  requestRunId: "coordinator-run",
  requestSignalId: "<m2@example.com>",
};

test("a revision started on the person's words keeps the approval of the version it replaced, pointing at those words", () => {
  expect(carriedApproval(asked, { version: 1, approved: 1 })).toEqual({
    principalId: "person-1",
    carriedFrom: 1,
    requestRunId: "coordinator-run",
    requestSignalId: "<m2@example.com>",
  });
});

test("a revision started on anything but the person's words carries no approval", () => {
  expect(
    carriedApproval(
      { requestedBy: null, requestRunId: null, requestSignalId: null },
      { version: 1, approved: 1 },
    ),
  ).toBeUndefined();
  // A run the hub has no start record for, such as one the coordinator did not start.
  expect(
    carriedApproval(undefined, { version: 1, approved: 1 }),
  ).toBeUndefined();
});

test("a revision of a version nobody approved carries nothing, even on the person's words", () => {
  expect(
    carriedApproval(asked, { version: 1, approved: undefined }),
  ).toBeUndefined();
  // v2 was never approved, so v3 does not inherit v1's approval past it.
  expect(carriedApproval(asked, { version: 2, approved: 1 })).toBeUndefined();
});
