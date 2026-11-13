import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  experimentalApprovals,
  preferenceGuidance,
  preferenceRegistry,
} from "../config/preferences.ts";
import { COORDINATOR } from "../workflows/coordinator-role.ts";
import {
  createPackageTools,
  DECK_CHECK,
  DECK_JSON,
  DECK_PDF,
  writePackageAssignment,
} from "../artifacts/package-tools.ts";

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "entry",
  pin: "@corbits-builder/presenter@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};

test("file_package refuses until check_deck passes on the current deck, then files approval_package with pinned sources", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sb-package-tools-test-"));
  const posted: { path: string; body: unknown }[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    if (path === "/api/workflow-project-scope") {
      return Response.json({
        tenantId: "tenant-1",
        projectId: "00000000-0000-4000-8000-000000000001",
        domain: "example.invalid",
        role: "presenter",
        workflows: {
          "writer-product-requirements": deployment,
          "writer-build-plan": deployment,
          "writer-document": deployment,
          reviewer: deployment,
          coder: deployment,
          designer: deployment,
          presenter: deployment,
        },
        openNetwork: false,
        build: {
          assetDirectory: "/tmp",
          browserCli: "/tmp/browser",
          childPath: "/tmp/child",
          dependencyRoots: ["/tmp"],
          ripgrepPath: "/tmp/rg",
          runtimeVersion: "1.0.0",
        },
      });
    }
    if (path.endsWith("/artifacts") && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push({ path, body });
      return Response.json({
        artifact: {
          artifactId: "pkg-1",
          kind: "approval_package",
          version: 1,
          sha256: "e".repeat(64),
        },
      });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
  } as unknown as RuntimeCapabilities;
  const runner = createPackageTools("presenter")({
    toolCwd: workspace,
    capabilities,
  } as never);
  const deck = {
    theme: {
      colors: {
        primary: "#2563EB",
        secondary: "#0EA5E9",
        accent: "#F59E0B",
        background: "#FFFFFF",
        text: "#111827",
        muted: "#6B7280",
      },
      fonts: { heading: "Inter", body: "Inter" },
    },
    slides: [
      {
        layout: "title",
        title: "CEO Sign-Off: Phase 1 Kickoff",
        subtitle: "Approve Q3 staffing and scope",
      },
    ],
  };

  try {
    await writePackageAssignment(workspace, {
      audience: "ceo",
      personaId: "ceo",
      personaLabel: "CEO",
      decisionNeeded: "Approve Q3 staffing and scope",
      tone: "Executive and direct",
      length: "6 slides",
      sources: [
        {
          artifactId: "id-brief",
          kind: "problem_brief",
          title: "Problem Brief",
          version: 2,
          sha256: "1".repeat(64),
        },
      ],
    });

    const wrote = await runner.run(
      { id: "w1", name: "write_deck", arguments: { deck } },
      new AbortController().signal,
    );
    expect(wrote.isError).toBeUndefined();
    expect(JSON.parse(String(wrote.content))).toMatchObject({
      slides: 1,
      passed: true,
      issues: [],
    });

    // Filing before check_deck must refuse with deck_check_failed.
    const beforeCheck = await runner.run(
      { id: "f1", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(beforeCheck.isError).toBe(true);
    expect(beforeCheck.content).toStartWith("deck_check_failed:");
    expect(posted).toHaveLength(0);

    // Run check_deck.
    const checked = await runner.run(
      { id: "c1", name: "check_deck", arguments: {} },
      new AbortController().signal,
    );
    expect(checked.isError).toBeUndefined();
    expect(checked.content).toStartWith("check passed:");

    // Mutating deck.json invalidates the check until check_deck runs again.
    await writeFile(
      join(workspace, DECK_JSON),
      JSON.stringify({ ...deck, slides: [...deck.slides] }),
      "utf8",
    );
    const staleCheck = await runner.run(
      { id: "f2", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(staleCheck.isError).toBe(true);
    expect(staleCheck.content).toStartWith("deck_check_failed:");

    // Writing {"passed":true} without sha256/pptxSha256/pdfSha256 is refused.
    await writeFile(
      join(workspace, DECK_CHECK),
      JSON.stringify({ passed: true }),
      "utf8",
    );
    const hashlessCheck = await runner.run(
      { id: "f2b", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(hashlessCheck.isError).toBe(true);
    expect(hashlessCheck.content).toStartWith("deck_check_failed:");

    // Re-check, then mutate deck.pdf on disk: file_package must refuse because pdfSha256 changed.
    await runner.run(
      { id: "c2a", name: "check_deck", arguments: {} },
      new AbortController().signal,
    );
    const originalPdf = await Bun.file(join(workspace, DECK_PDF)).bytes();
    await writeFile(join(workspace, DECK_PDF), "%PDF-1.4\ntampered", "utf8");
    const tamperedPdfRes = await runner.run(
      { id: "f2c", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(tamperedPdfRes.isError).toBe(true);
    expect(tamperedPdfRes.content).toContain(".builder/deck.pdf changed");
    await writeFile(join(workspace, DECK_PDF), originalPdf);

    // Re-check and verify file_package refuses overriding sealed audience or sources.
    await runner.run(
      { id: "c2", name: "check_deck", arguments: {} },
      new AbortController().signal,
    );
    const mismatchedAudience = await runner.run(
      {
        id: "f2d",
        name: "file_package",
        arguments: { audience: "investor" },
      },
      new AbortController().signal,
    );
    expect(mismatchedAudience.isError).toBe(true);
    expect(mismatchedAudience.content).toStartWith(
      "invalid_package_assignment:",
    );
    const filed = await runner.run(
      { id: "f3", name: "file_package", arguments: {} },
      new AbortController().signal,
    );
    expect(filed.isError).toBeUndefined();
    expect(posted).toHaveLength(1);
    const body = posted[0]!.body as {
      kind: string;
      title: string;
      content: string;
    };
    expect(body.kind).toBe("approval_package");
    expect(body.title).toBe("CEO Sign-Off: Phase 1 Kickoff");
    const bundle = JSON.parse(body.content);
    expect(bundle.manifest.audience).toBe("ceo");
    expect(bundle.manifest.decisionNeeded).toBe(
      "Approve Q3 staffing and scope",
    );
    expect(bundle.manifest.sources).toEqual([
      {
        artifactId: "id-brief",
        kind: "problem_brief",
        title: "Problem Brief",
        version: 2,
        sha256: "1".repeat(64),
      },
    ]);
    expect(bundle.deck.slides).toHaveLength(1);
    expect(typeof bundle.pptxBase64).toBe("string");
    expect(bundle.pptxBase64.length).toBeGreaterThan(100);
    expect(typeof bundle.pdfBase64).toBe("string");
    expect(
      Buffer.from(bundle.pdfBase64, "base64").subarray(0, 5).toString("utf8"),
    ).toBe("%PDF-");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("presenter workflow entry binds Medium tier inference and approval_package write grant", async () => {
  const { MODEL_PROVIDERS, tierBinding } = await import("../config/models.ts");
  const { resolveRoleInference } =
    await import("../workflows/role-inference.ts");
  const { CATALOG, PLUGINS_FOLDER, roleModel } =
    await import("../plugins/catalog.ts");
  const presenter = CATALOG.role("presenter");
  if (!presenter) throw new Error("presenter_role_missing");
  const choice = { profile: "anthropic_default" };
  const { tier, budget } = roleModel(presenter);
  expect(tier).toBe("medium");
  const binding = tierBinding(MODEL_PROVIDERS, choice, tier);
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(
    resolveRoleInference(MODEL_PROVIDERS, budget, binding),
  );
  const { resolve } = await import("node:path");
  const brought = CATALOG.packages.get("presenter");
  if (brought === undefined || !("entry" in brought))
    throw new Error("presenter_package_missing");
  const entry = await import(resolve(PLUGINS_FOLDER, brought.entry));
  expect(entry.director).toBeDefined();
  expect(entry.default.steps.present).toMatchObject({ triggers: 1 });
  expect(entry.default.grantRequirements).toEqual([
    { resource: "sb-project:*", action: "read", source: "invoker" },
    {
      resource: "sb-artifact:approval_package",
      action: "write",
      source: "invoker",
    },
  ]);
});

test("experimental_approvals preference includes coordinator guidance when enabled and omits it when disabled", () => {
  const registryIds = preferenceRegistry().preferences.map((entry) => entry.id);
  expect(registryIds).toContain("experimental_approvals");
  expect(registryIds).not.toContain("experimental_slide_decks");
  expect(experimentalApprovals(null)).toBe(false);
  expect(experimentalApprovals({ experimental_approvals: "yes" })).toBe(true);
  expect(experimentalApprovals({ experimental_approvals: "no" })).toBe(false);

  const enabledGuidance = preferenceGuidance(
    { experimental_approvals: "yes" },
    COORDINATOR,
  ).join("\n");
  expect(enabledGuidance).toContain("files the next approval_package");
  expect(enabledGuidance).toContain("approval_package");
  expect(enabledGuidance).toContain("reviewer feedback (external");

  const disabledGuidance = preferenceGuidance(
    { experimental_approvals: "no" },
    COORDINATOR,
  ).join("\n");
  expect(disabledGuidance).not.toContain("files the next approval_package");
  expect(disabledGuidance).not.toContain("approval_package");
  expect(disabledGuidance).not.toContain("reviewer feedback");
  expect(disabledGuidance).not.toContain("Approvals:");
});
