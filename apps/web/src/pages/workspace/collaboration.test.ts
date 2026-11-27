import { describe, expect, test } from "bun:test";
import type { Wait } from "../../api/types.ts";
import {
  documentApprovalsFrom,
  openApprovalOf,
  pendingApprovalsFrom,
} from "./collaboration.ts";

const browse: Wait = {
  tenantId: "tenant-1",
  runId: "run-c",
  approvalId: "appr-1",
  createdAt: "2026-11-20T10:00:00.000Z",
  toolName: "browser.open_page",
  subject: "https://example.com",
};
const install: Wait = {
  tenantId: "tenant-1",
  runId: "run-coder",
  approvalId: "appr-2",
  createdAt: "2026-11-20T10:01:00.000Z",
  toolName: "coder.install",
  packages: ["zod"],
};
// The coordinator's open question: the person's move, but no approval.
const question: Wait = { runId: "run-c", park: { seq: 4 } };

describe("the open decisions as approval cards", () => {
  test("each approval is a card placed when it was raised, with what it asks", () => {
    expect(documentApprovalsFrom([browse, question, install])).toEqual([
      {
        approvalId: "appr-1",
        tenantId: "tenant-1",
        at: Date.parse("2026-11-20T10:00:00.000Z"),
        toolName: "browser.open_page",
        subject: "https://example.com",
      },
      {
        approvalId: "appr-2",
        tenantId: "tenant-1",
        at: Date.parse("2026-11-20T10:01:00.000Z"),
        toolName: "coder.install",
        packages: ["zod"],
      },
    ]);
  });

  test("an approval with no tenant to decide it in is no card", () => {
    const { tenantId: _tenantId, ...untenanted } = browse;
    expect(documentApprovalsFrom([untenanted])).toEqual([]);
  });

  test("an approval with no readable time still shows, unplaced", () => {
    const [card] = documentApprovalsFrom([{ ...browse, createdAt: "soon" }]);
    expect(card).not.toHaveProperty("at");
    expect(card?.approvalId).toBe("appr-1");
  });

  test("a card decided here is no longer pending, though the read still lists it", () => {
    const pending = pendingApprovalsFrom(
      [browse, install],
      [{ approvalId: "appr-1", outcome: { status: "approved" } }],
    );
    expect(pending.map((approval) => approval.approvalId)).toEqual(["appr-2"]);
  });
});

describe("the approval a message answers", () => {
  test("a request to install packages is never it", () => {
    expect(
      openApprovalOf(documentApprovalsFrom([install, browse]))?.approvalId,
    ).toBe("appr-1");
    expect(openApprovalOf(documentApprovalsFrom([install]))).toBeUndefined();
  });

  test("before the open decisions are read there is none", () => {
    expect(openApprovalOf(undefined)).toBeUndefined();
  });
});
