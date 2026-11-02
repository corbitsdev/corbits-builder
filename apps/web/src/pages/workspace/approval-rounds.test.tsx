import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApprovalRound } from "@corbits-builder/schemas/approval-round";
import { ApprovalRoundsPanel, SharePackageDialog } from "./approval-rounds.tsx";
import { WorkspaceApprovals } from "../settings.tsx";

const openRound: ApprovalRound = {
  roundId: "rnd_1",
  projectId: "proj_1",
  artifactId: "art_pkg_1",
  packageVersion: 1,
  packageSha256: "a".repeat(64),
  expiry: "7d",
  status: "open",
  createdAt: "2026-04-01T12:00:00.000Z",
  expiresAt: "2026-04-08T12:00:00.000Z",
  reviewers: [
    {
      id: "rev_1",
      name: "Dana Reviewer",
      persona: "Finance VP",
      email: "dana@example.com",
      state: "decided",
      decision: {
        outcome: "request_changes",
        note: "Clarify Q3 staffing assumptions.",
        slideNotes: [],
        decidedAt: "2026-04-02T09:00:00.000Z",
      },
    },
    {
      id: "rev_2",
      name: "Eli Security",
      persona: "Security Lead",
      state: "sent",
    },
  ],
  triage: [],
};

describe("approval rounds panel", () => {
  test("renders open round with reviewer states, per-person Download .zip buttons, recorded decision, and disabled settle button while a reviewer is pending", () => {
    const html = renderToStaticMarkup(
      <ApprovalRoundsPanel
        projectId="proj_1"
        packageVersion={1}
        initialRounds={[openRound]}
      />,
    );
    expect(html).toContain("Share for sign-off");
    expect(html).toContain("Add reviewers &amp; download .zip");
    expect(html).toContain("Package v1 reviewers");
    expect(html).toContain("Dana Reviewer");
    expect(html).toContain("Finance VP");
    expect(html).toContain('aria-label="Download .zip for Dana Reviewer"');
    expect(html).toContain("Decided");
    expect(html).toContain("Request changes");
    expect(html).toContain("Clarify Q3 staffing assumptions.");
    expect(html).toContain("Amend decision");
    expect(html).toContain("Eli Security");
    expect(html).toContain("Security Lead");
    expect(html).toContain('aria-label="Download .zip for Eli Security"');
    expect(html).toContain("Sent");
    expect(html).toContain("Record decision");
    expect(html).toContain("Mark settled");
  });

  test("renders share dialog with expiry selector, numbered reviewer inputs, Save & download .zip button, and cancel button", () => {
    const html = renderToStaticMarkup(
      <SharePackageDialog
        projectId="proj_1"
        packageVersion={1}
        onCreated={() => {}}
        onCancel={() => {}}
        onFault={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Share approval package"');
    expect(html).toContain('aria-label="Expires in"');
    expect(html).toContain('aria-label="Reviewer 1"');
    expect(html).toContain('aria-label="Reviewer 1 Pick from workspace"');
    expect(html).toContain("Dana Chen (CEO)");
    expect(html).toContain("Marcus Vance (CTO)");
    expect(html).toContain("Priya Patel (VP Product)");
    expect(html).toContain('aria-label="Reviewer 1 Reviewer name"');
    expect(html).toContain('aria-label="Reviewer 1 Persona"');
    expect(html).toContain("Budget approver");
    expect(html).toContain("Technical approver");
    expect(html).toContain("Other…");
    expect(html).toContain('aria-label="Reviewer 1 Email (optional)"');
    expect(html).toContain("Save to workspace?");
    expect(html).toContain(
      "Saves this reviewer to the workspace so you can pick them in any project without retyping their details.",
    );
    expect(html).toContain("Add reviewer");
    expect(html).toContain("Save &amp; download .zip");
    expect(html).toContain("Cancel");
  });

  test("renders WorkspaceApprovals settings section with require stakeholder approval toggle and seeded workspace reviewers", () => {
    const html = renderToStaticMarkup(<WorkspaceApprovals />);
    expect(html).toContain("Workspace approvals");
    expect(html).toContain("Require stakeholder approval");
    expect(html).toContain("Workspace reviewers");
    expect(html).toContain("Dana Chen");
    expect(html).toContain("CEO");
    expect(html).toContain("Marcus Vance");
    expect(html).toContain("CTO");
    expect(html).toContain("Priya Patel");
    expect(html).toContain("VP Product");
    expect(html).toContain("Remove");
    expect(html).toContain("Add reviewer");
    expect(html).toContain("Other…");
  });
});
