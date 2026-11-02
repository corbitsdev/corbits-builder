import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { unzip } from "@corbits/zip";
import { base64Encode } from "@intx/types";
import type { TenantEnv } from "@intx/hub-api";
import {
  APPROVAL_PACKAGE_KIND,
  createApprovalRoundService,
  mountApprovalRoundRoutes,
  type ApprovalRoundStore,
  type StoredApprovalRound,
  type StoredPackageVersion,
} from "./approval-rounds.ts";
import { DEFAULT_WORKSPACE_REVIEWERS } from "../config/approval-rounds.ts";
import type { WorkspaceReviewer } from "@corbits-builder/schemas/approval-round";
import { ProjectError } from "../projects/errors.ts";
import type { Actor } from "../lib/actor.ts";

const OWNER: Actor = {
  tenantId: "tenant_proj_1",
  principalId: "usr_owner",
};

const AGENT_CALLER: Actor = {
  tenantId: "tenant_proj_1",
  principalId: "agt_coordinator",
};

const PPTX_BYTES = new TextEncoder().encode("PK-pptx-binary-fixture");
const PDF_BYTES = new TextEncoder().encode("%PDF-1.7-binary-fixture");

function makePackageFixture(
  overrides: Partial<StoredPackageVersion> = {},
): StoredPackageVersion {
  const content = JSON.stringify({
    manifest: {
      audience: "Executive committee",
      decisionNeeded: "Approve Q3 rollout budget",
      tone: "concise",
      length: "short",
      sources: [
        {
          artifactId: "art_brief_1",
          kind: "brief",
          title: "Product Brief",
          version: 2,
          sha256: "a".repeat(64),
        },
        {
          artifactId: "art_req_1",
          kind: "requirements",
          title: "Requirements",
          version: 1,
          sha256: "b".repeat(64),
        },
      ],
    },
    deck: {
      theme: {},
      slides: [{ layout: "title", title: "Executive Approval Package" }],
    },
    pptxBase64: base64Encode(PPTX_BYTES),
    pdfBase64: `data:application/pdf;base64,${base64Encode(PDF_BYTES)}`,
  });
  return {
    projectTitle: "Acme Portal",
    artifactId: "art_pkg_1",
    version: 1,
    latestVersion: 1,
    sha256: "c".repeat(64),
    title: "Executive Approval Package",
    content,
    projectDocuments: [
      {
        kind: "brief",
        title: "Product Brief",
        version: 2,
        sha256: "a".repeat(64),
        content: "# Product Brief\n\nApproved brief content.",
      },
      {
        kind: "requirements",
        title: "Requirements",
        version: 1,
        sha256: "b".repeat(64),
        content: "# Requirements\n\nApproved requirements content.",
      },
    ],
    ...overrides,
  };
}

function createFakeStore(options?: {
  initialNow?: Date;
  pkg?: StoredPackageVersion;
  nonPersonIds?: readonly string[];
  coordinatorRunId?: string;
}) {
  let currentNow = options?.initialNow ?? new Date("2026-04-01T12:00:00.000Z");
  let pkg = options?.pkg ?? makePackageFixture();
  const coordinatorRunId = options?.coordinatorRunId ?? "wfr_coord_1";
  const nonPerson = new Set(
    options?.nonPersonIds ?? [AGENT_CALLER.principalId],
  );
  const approvals: Array<{
    actor: Actor;
    projectId: string;
    artifactId: string;
    version: number;
    sha256: string;
  }> = [];
  const rounds = new Map<string, StoredApprovalRound>();
  const workspaceReviewers: WorkspaceReviewer[] = [
    ...DEFAULT_WORKSPACE_REVIEWERS,
  ];

  const store: ApprovalRoundStore = {
    now: () => currentNow,
    async authorize(actor, _projectId, _action, requirePerson) {
      if (requirePerson && nonPerson.has(actor.principalId)) {
        throw new ProjectError(403, "approval_round_person_only");
      }
    },
    async readPackage(_actor, _projectId, version) {
      if (version !== pkg.version) {
        throw new ProjectError(404, "package_not_found", { version });
      }
      return pkg;
    },
    async recordPackageApproval(actor, projectId, ref) {
      approvals.push({
        actor,
        projectId,
        artifactId: ref.artifactId,
        version: ref.version,
        sha256: ref.sha256,
      });
    },
    async insertRound(round) {
      rounds.set(round.roundId, structuredClone(round));
    },
    async listRounds(tenantId, projectId) {
      return [...rounds.values()].filter(
        (item) => item.tenantId === tenantId && item.projectId === projectId,
      );
    },
    async readRound(tenantId, projectId, roundId) {
      const found = rounds.get(roundId);
      if (
        !found ||
        found.tenantId !== tenantId ||
        found.projectId !== projectId
      ) {
        return undefined;
      }
      return structuredClone(found);
    },
    async updateRound(round) {
      rounds.set(round.roundId, structuredClone(round));
    },
    async activeCoordinatorRunId() {
      return coordinatorRunId;
    },
    async listWorkspaceReviewers() {
      return [...workspaceReviewers];
    },
    async saveWorkspaceReviewers(_tenantId, entries) {
      for (const item of entries) {
        const idx = workspaceReviewers.findIndex(
          (entry) => entry.name.toLowerCase() === item.name.toLowerCase(),
        );
        const next: WorkspaceReviewer = {
          id: `ws-rev-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: item.name,
          persona: item.persona,
          ...(item.email === undefined ? {} : { email: item.email }),
        };
        if (idx >= 0) {
          workspaceReviewers[idx] = next;
        } else {
          workspaceReviewers.push(next);
        }
      }
      return [...workspaceReviewers];
    },
  };

  return {
    store,
    approvals,
    rounds,
    advanceTime(ms: number) {
      currentNow = new Date(currentNow.getTime() + ms);
    },
    setPackage(next: StoredPackageVersion) {
      pkg = next;
    },
  };
}

function createTestApp(
  service: ReturnType<typeof createApprovalRoundService>,
  actor: Actor = OWNER,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  const app = new Hono<TenantEnv>();
  app.use("*", async (c, next) => {
    c.set("tenant", { id: actor.tenantId } as never);
    c.set("principal", { id: actor.principalId } as never);
    await next();
  });
  app.onError((err, c) => {
    if (err instanceof ProjectError) {
      return c.json(
        { error: err.code, ...err.details },
        err.status as ContentfulStatusCode,
      );
    }
    throw err;
  });
  mountApprovalRoundRoutes(app, service, nativeFetch);
  return app;
}

describe("approval package zip and approval rounds", () => {
  test("GET /:projectId/packages/:version/zip packs deck.pptx, deck.pdf, README.md, manifest.json, and grounded documents deterministically", async () => {
    const { store } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const res1 = await app.request("/proj_1/packages/1/zip");
    expect(res1.status).toBe(200);
    expect(res1.headers.get("content-type")).toBe("application/zip");
    expect(res1.headers.get("content-disposition")).toContain(
      "Acme-Portal-package-v1.zip",
    );

    const bytes1 = new Uint8Array(await res1.arrayBuffer());
    const res2 = await app.request("/proj_1/packages/1/zip");
    const bytes2 = new Uint8Array(await res2.arrayBuffer());
    expect(bytes1).toEqual(bytes2);

    const unzipped = await unzip(bytes1);
    const entries = new Map(unzipped.map((entry) => [entry.path, entry.data]));
    expect([...entries.keys()].sort()).toEqual([
      "README.md",
      "deck.pdf",
      "deck.pptx",
      "documents/brief.md",
      "documents/requirements.md",
      "manifest.json",
    ]);
    expect(entries.get("deck.pptx")).toEqual(PPTX_BYTES);
    expect(entries.get("deck.pdf")).toEqual(PDF_BYTES);

    const readme = new TextDecoder().decode(entries.get("README.md"));
    expect(readme).toContain("# Acme Portal — Executive Approval Package (v1)");
    expect(readme).toContain("Executive committee");
    expect(readme).toContain("Approve Q3 rollout budget");
    expect(readme).toContain("Product Brief (brief): v2");

    const manifest = JSON.parse(
      new TextDecoder().decode(entries.get("manifest.json")),
    ) as { version: number; sha256: string; sources: unknown[] };
    expect(manifest.version).toBe(1);
    expect(manifest.sha256).toBe("c".repeat(64));
    expect(manifest.sources).toHaveLength(2);
  });

  test("personalizes the .zip filename, README.md, and manifest.json when a reviewer is specified", async () => {
    const { store } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const created = await service.start(OWNER, "proj_1", {
      packageVersion: 1,
      expiry: "7d",
      reviewers: [{ name: "Dana Chen", persona: "CEO" }],
    });
    const reviewer = created.reviewers[0]!;

    const res = await app.request(
      `/proj_1/packages/1/zip?roundId=${encodeURIComponent(created.roundId)}&reviewerId=${encodeURIComponent(reviewer.id)}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      "acme-portal-approval-package-for-dana-chen-ceo.zip",
    );

    const unzipped = await unzip(new Uint8Array(await res.arrayBuffer()));
    const entries = new Map(
      unzipped.map((entry) => [
        entry.path,
        new TextDecoder().decode(entry.data),
      ]),
    );
    expect(entries.get("README.md")).toContain("Prepared for: Dana Chen (CEO)");
    const manifest = JSON.parse(entries.get("manifest.json")!) as {
      reviewer?: { name: string; persona: string };
    };
    expect(manifest.reviewer).toEqual({ name: "Dana Chen", persona: "CEO" });
  });

  test("packs the pinned version of an upstream document after a newer version is filed and extracts DESIGN.md from a design bundle", async () => {
    const designBundleJson = JSON.stringify({
      files: {
        "DESIGN.md":
          "# Acme Design Plan\n\nClean grid and accessible contrast.",
        "designs/index.html": "<!doctype html><html><body>Mock</body></html>",
      },
    });
    const content = JSON.stringify({
      manifest: {
        audience: "Executive committee",
        decisionNeeded: "Approve Q3 rollout budget",
        tone: "concise",
        length: "short",
        sources: [
          {
            artifactId: "art_brief_1",
            kind: "problem_brief",
            title: "Problem Brief",
            version: 1,
            sha256: "1".repeat(64),
          },
          {
            artifactId: "art_design_1",
            kind: "design",
            title: "Design Plan",
            version: 1,
            sha256: "2".repeat(64),
          },
        ],
      },
      deck: {
        theme: {},
        slides: [{ layout: "title", title: "Executive Approval Package" }],
      },
      pptxBase64: base64Encode(PPTX_BYTES),
      pdfBase64: `data:application/pdf;base64,${base64Encode(PDF_BYTES)}`,
    });
    const { store } = createFakeStore({
      pkg: makePackageFixture({
        content,
        projectDocuments: [
          {
            kind: "problem_brief",
            title: "Problem Brief",
            version: 1,
            sha256: "1".repeat(64),
            content: "# Problem Brief v1\n\nOriginal pinned scope.",
          },
          {
            kind: "problem_brief",
            title: "Problem Brief",
            version: 2,
            sha256: "9".repeat(64),
            content: "# Problem Brief v2\n\nLater unpinned revision.",
          },
          {
            kind: "design",
            title: "Design Plan",
            version: 1,
            sha256: "2".repeat(64),
            content: designBundleJson,
          },
        ],
      }),
    });
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const res = await app.request("/proj_1/packages/1/zip");
    expect(res.status).toBe(200);
    const unzipped = await unzip(new Uint8Array(await res.arrayBuffer()));
    const entries = new Map(
      unzipped.map((entry) => [
        entry.path,
        new TextDecoder().decode(entry.data),
      ]),
    );
    expect(entries.get("documents/problem_brief.md")).toBe(
      "# Problem Brief v1\n\nOriginal pinned scope.",
    );
    expect(entries.get("documents/design.md")).toBe(
      "# Acme Design Plan\n\nClean grid and accessible contrast.",
    );
  });

  test("POST /:projectId/approval-rounds records the owner's package approval and starts a round", async () => {
    const { store, approvals } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const createRes = await app.request("/proj_1/approval-rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageVersion: 1,
        expiry: "7d",
        reviewers: [
          {
            name: "Dana Reviewer",
            persona: "Finance VP",
            email: "dana@example.com",
          },
          {
            name: "Eli Security",
            persona: "Security Lead",
          },
        ],
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      roundId: string;
      status: string;
      packageVersion: number;
      packageSha256: string;
      reviewers: Array<{
        id: string;
        name: string;
        persona: string;
        state: string;
      }>;
    };
    expect(created.status).toBe("open");
    expect(created.packageVersion).toBe(1);
    expect(created.packageSha256).toBe("c".repeat(64));
    expect(created.reviewers).toHaveLength(2);
    expect(created.reviewers.map((r) => r.state)).toEqual(["sent", "sent"]);

    expect(approvals).toEqual([
      {
        actor: OWNER,
        projectId: "proj_1",
        artifactId: "art_pkg_1",
        version: 1,
        sha256: "c".repeat(64),
      },
    ]);
    expect(APPROVAL_PACKAGE_KIND).toBe("approval_package");
  });

  test("rejects starting an approval round from a non-user principal or for a stale package version", async () => {
    const { store, setPackage } = createFakeStore();
    const service = createApprovalRoundService(store);

    const agentApp = createTestApp(service, AGENT_CALLER);
    const agentRes = await agentApp.request("/proj_1/approval-rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageVersion: 1,
        expiry: "24h",
        reviewers: [{ name: "Dana", persona: "VP" }],
      }),
    });
    expect(agentRes.status).toBe(403);
    expect(await agentRes.json()).toEqual({
      error: "approval_round_person_only",
    });

    setPackage(makePackageFixture({ version: 1, latestVersion: 2 }));
    const ownerApp = createTestApp(service, OWNER);
    const staleRes = await ownerApp.request("/proj_1/approval-rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageVersion: 1,
        expiry: "24h",
        reviewers: [{ name: "Dana", persona: "VP" }],
      }),
    });
    expect(staleRes.status).toBe(409);
    expect((await staleRes.json()) as { error: string }).toMatchObject({
      error: "artifact_ref_stale",
    });
  });

  test("records and amends reviewer decisions with overall and per-slide notes, then settles the round", async () => {
    const { store } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const created = await service.start(OWNER, "proj_1", {
      packageVersion: 1,
      expiry: "7d",
      reviewers: [
        { name: "Dana", persona: "Finance VP" },
        { name: "Eli", persona: "Security Lead" },
      ],
    });
    const [dana, eli] = created.reviewers;
    expect(dana).toBeDefined();
    expect(eli).toBeDefined();

    // Cannot settle while reviewers are still pending before expiry
    const earlySettle = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/settle`,
      { method: "POST" },
    );
    expect(earlySettle.status).toBe(409);
    expect(await earlySettle.json()).toEqual({
      error: "round_reviewers_pending",
      roundId: created.roundId,
    });

    // Record Dana's initial request_changes decision with per-slide notes
    const danaRes = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/reviewers/${dana!.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome: "request_changes",
          note: "Clarify Q3 staffing assumptions.",
          slideNotes: [
            { slide: 3, text: "Break out contractor vs FTE costs." },
          ],
        }),
      },
    );
    expect(danaRes.status).toBe(200);

    // Amend Dana's decision to approve while round is still open
    const amendRes = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/reviewers/${dana!.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome: "approve",
          note: "Updated numbers look solid.",
        }),
      },
    );
    expect(amendRes.status).toBe(200);

    // Record Eli's approval without notes
    const eliRes = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/reviewers/${eli!.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome: "approve",
        }),
      },
    );
    expect(eliRes.status).toBe(200);

    // Settle the round now that all reviewers have decided
    const settleRes = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/settle`,
      { method: "POST" },
    );
    expect(settleRes.status).toBe(200);
    const settled = (await settleRes.json()) as {
      status: string;
      settledAt?: string;
    };
    expect(settled.status).toBe("settled");
    expect(settled.settledAt).toBeDefined();

    // Amending after settlement is rejected
    const afterSettle = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/reviewers/${dana!.id}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "comment", note: "Too late" }),
      },
    );
    expect(afterSettle.status).toBe(409);
    expect(await afterSettle.json()).toEqual({
      error: "approval_round_settled",
      roundId: created.roundId,
    });
  });

  test("marks pending reviewers expired after the round expiry window and allows settling", async () => {
    const { store, advanceTime } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const created = await service.start(OWNER, "proj_1", {
      packageVersion: 1,
      expiry: "24h",
      reviewers: [{ name: "Dana", persona: "Finance VP" }],
    });
    const reviewerId = created.reviewers[0]!.id;

    // Advance past 24h
    advanceTime(25 * 60 * 60 * 1000);

    const listRes = await app.request("/proj_1/approval-rounds");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      rounds: Array<{ status: string; reviewers: Array<{ state: string }> }>;
    };
    expect(listed.rounds[0]?.status).toBe("expired");
    expect(listed.rounds[0]?.reviewers[0]?.state).toBe("expired");

    // Recording a decision on an expired round is rejected
    const lateDecision = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/reviewers/${reviewerId}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: "approve" }),
      },
    );
    expect(lateDecision.status).toBe(409);

    // Settling an expired round succeeds
    const settleRes = await app.request(
      `/proj_1/approval-rounds/${created.roundId}/settle`,
      { method: "POST" },
    );
    expect(settleRes.status).toBe(200);
    expect(((await settleRes.json()) as { status: string }).status).toBe(
      "settled",
    );
  });

  test("saves reviewers marked saveToWorkspace at the workspace level and returns workspaceReviewers on list", async () => {
    const { store } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    const createRes = await app.request("/proj_1/approval-rounds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageVersion: 1,
        expiry: "7d",
        reviewers: [
          {
            name: "Jordan Lee",
            persona: "Budget approver",
            email: "jordan@example.com",
            saveToWorkspace: true,
          },
        ],
      }),
    });
    expect(createRes.status).toBe(200);

    const listRes = await app.request("/proj_1/approval-rounds");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      rounds: unknown[];
      workspaceReviewers?: WorkspaceReviewer[];
    };
    expect(listed.workspaceReviewers).toBeDefined();
    expect(
      listed.workspaceReviewers?.some(
        (reviewer) =>
          reviewer.name === "Jordan Lee" &&
          reviewer.persona === "Budget approver",
      ),
    ).toBe(true);
  });

  test("rejects whitespace-only name, persona, or email before inserting a round", async () => {
    const { store, rounds } = createFakeStore();
    const service = createApprovalRoundService(store);
    const app = createTestApp(service);

    for (const invalidReviewer of [
      { name: "   ", persona: "CEO" },
      { name: "Dana", persona: "   " },
      { name: "Dana", persona: "CEO", email: "   " },
    ]) {
      const res = await app.request("/proj_1/approval-rounds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageVersion: 1,
          expiry: "7d",
          reviewers: [invalidReviewer],
        }),
      });
      expect(res.status).toBe(400);
    }
    expect(rounds.size).toBe(0);
  });

  test("preserves both reviewers' decisions when recorded concurrently", async () => {
    const { store } = createFakeStore({ coordinatorRunId: "wfr_coord_99" });
    const service = createApprovalRoundService(store);
    const app = createTestApp(service, OWNER);

    const created = await service.start(OWNER, "proj_1", {
      packageVersion: 1,
      expiry: "7d",
      reviewers: [
        { name: "Dana", persona: "CEO" },
        { name: "Marcus", persona: "CTO" },
      ],
    });
    const [dana, marcus] = created.reviewers;

    const [resDana, resMarcus] = await Promise.all([
      app.request(
        `/proj_1/approval-rounds/${created.roundId}/reviewers/${dana!.id}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            outcome: "request_changes",
            note: "Tighten Phase 1 budget.",
          }),
        },
      ),
      app.request(
        `/proj_1/approval-rounds/${created.roundId}/reviewers/${marcus!.id}/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            outcome: "approve",
            note: "Architecture looks solid.",
          }),
        },
      ),
    ]);
    expect(resDana.status).toBe(200);
    expect(resMarcus.status).toBe(200);

    const listed = await service.list(OWNER, "proj_1");
    const round = listed.rounds[0]!;
    expect(
      round.reviewers.find((r) => r.id === dana!.id)?.decision?.outcome,
    ).toBe("request_changes");
    expect(
      round.reviewers.find((r) => r.id === marcus!.id)?.decision?.outcome,
    ).toBe("approve");
    expect(round.triage).toHaveLength(2);
  });
});
