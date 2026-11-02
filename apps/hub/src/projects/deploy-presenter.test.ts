import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  AUDIENCE_PERSONAS,
  findAudiencePersona,
  formatPersonaGuidance,
  presenterAssignmentMessage,
} from "../config/personas.ts";
import {
  createPackageTools,
  DECK_JSON,
  writePackageAssignment,
} from "../artifacts/package-tools.ts";
import { createDeployTools } from "./deploy-tools.ts";

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

test("AUDIENCE_PERSONAS defines ceo, cto, investor, client and end_user with their default documents", () => {
  expect(AUDIENCE_PERSONAS.map((persona) => persona.id)).toEqual([
    "ceo",
    "cto",
    "investor",
    "client",
    "end_user",
  ]);
  expect(findAudiencePersona("ceo")?.defaultDocuments).toEqual([
    "problem_brief",
    "approaches",
    "build_plan",
  ]);
  expect(findAudiencePersona("cto")?.defaultDocuments).toEqual([
    "problem_brief",
    "constraints",
    "approaches",
    "build_plan",
  ]);
  expect(findAudiencePersona("investor")?.defaultDocuments).toEqual([
    "problem_brief",
    "approaches",
    "product_requirements",
  ]);
  expect(findAudiencePersona("client")?.defaultDocuments).toEqual([
    "problem_brief",
    "product_requirements",
    "build_plan",
  ]);
  expect(findAudiencePersona("end_user")?.defaultDocuments).toEqual([
    "problem_brief",
    "product_requirements",
  ]);

  const guidance = formatPersonaGuidance(findAudiencePersona("ceo")!);
  expect(guidance).toContain("Audience persona: CEO (ceo)");
  expect(guidance).toContain(
    "business outcome, strategic fit, risks, resource ask",
  );
  const message = presenterAssignmentMessage({
    projectId: "proj-1",
    audience: "ceo",
    decisionNeeded: "Approve Q3 staffing and budget",
    tone: "Executive and direct",
    length: "6 slides",
    instruction:
      "Prepare an executive deck for our CEO covering the brief, chosen approach and build plan.",
    documents: [
      {
        artifactId: "art-brief",
        kind: "problem_brief",
        title: "Problem Brief",
        version: 2,
        sha256: "a".repeat(64),
        content: "# Problem Brief\nCut onboarding time in half.",
      },
    ],
  });
  expect(message).toContain("Approve Q3 staffing and budget");
  expect(message).toContain("Cut onboarding time in half.");
  expect(message).toContain('"personaId": "ceo"');
});

test("deploy_presenter requires approved documents and pins source refs and filed design tokens", async () => {
  const sha = (char: string) => char.repeat(64);
  const documents: Record<string, unknown>[] = [
    {
      kind: "problem_brief",
      artifactId: "id-brief",
      title: "Problem Brief",
      version: 2,
      sha256: sha("1"),
      approvedVersion: 2,
    },
    {
      kind: "approaches",
      artifactId: "id-approaches",
      title: "Approaches",
      version: 1,
      sha256: sha("2"),
    },
    {
      kind: "build_plan",
      artifactId: "id-plan",
      title: "Build Plan",
      version: 3,
      sha256: sha("3"),
      approvedVersion: 3,
    },
    {
      kind: "design",
      artifactId: "id-design",
      title: "Calm Notebook",
      version: 4,
      sha256: sha("4"),
      approvedVersion: 4,
    },
  ];
  const deployed: unknown[] = [];
  const mailed: string[] = [];
  const fetch = async (path: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path.endsWith("/workflows/deployments")) {
      deployed.push(body);
      return Response.json({
        id: "run-presenter-1",
        tenantId: "tenant",
        definitionAssetId: "asset",
        status: "deployed",
        createdAt: new Date(0).toISOString(),
      });
    }
    if (path.endsWith("/artifacts") && init.method === "GET")
      return Response.json({
        artifacts: documents,
        inFlight: [],
        preferences: {},
      });
    if (path.includes("/artifacts/") && init.method === "GET") {
      const found = documents.find((item) =>
        path.includes("/artifacts/" + String(item["artifactId"])),
      )!;
      const content =
        found["kind"] === "design"
          ? JSON.stringify({
              files: {
                "DESIGN.md":
                  '---\nname: "Calm Notebook"\n---\n\n# Calm Notebook',
                "designs/index.html": "<main>Mockup</main>",
                "designs/styles.css": ":root { --primary: #2563eb; }",
              },
            })
          : `Full text of ${String(found["title"])}`;
      return Response.json({
        artifactId: found["artifactId"],
        kind: found["kind"],
        title: found["title"],
        version: found["version"],
        sha256: found["sha256"],
        filedAt: new Date(0).toISOString(),
        content,
      });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: (name: string) =>
      name === "credentials"
        ? { resolve: async () => ({ kind: "http", fetch }) }
        : {
            send: async (msg: { content: string }) => {
              mailed.push(msg.content);
            },
          },
  } as unknown as RuntimeCapabilities;
  const tools = createDeployTools({
    tenantId: "tenant",
    projectId: "project",
    domain: "example.invalid",
    workflows: {
      writer: deployment,
      reviewer: deployment,
      coder: deployment,
      designer: deployment,
      presenter: deployment,
    },
    maxResultBytes: 65536,
  })({ capabilities } as never);

  const callArgs = {
    audience: "ceo",
    decisionNeeded: "Approve budget and phase 1 kickoff",
    kinds: ["problem_brief", "approaches", "build_plan"],
    tone: "Executive and direct",
    length: "6-8 slides",
    instruction:
      "Build the CEO approval deck leading with the phase 1 ask and ROI.",
  };

  // Unapproved approaches is refused first.
  const unapproved = await tools.run(
    { id: "call-1", name: "deploy_presenter", arguments: callArgs },
    new AbortController().signal,
  );
  expect(unapproved.isError).toBe(true);
  expect(unapproved.content).toStartWith("approaches_not_approved:");
  expect(deployed).toHaveLength(0);

  // Approve approaches and deploy again.
  documents.find((doc) => doc["kind"] === "approaches")!["approvedVersion"] = 1;
  const approved = await tools.run(
    { id: "call-2", name: "deploy_presenter", arguments: callArgs },
    new AbortController().signal,
  );
  expect(approved.isError).toBeUndefined();
  expect(JSON.parse(String(approved.content))).toEqual({
    runId: "run-presenter-1",
    role: "presenter",
    status: "deployed",
  });
  expect(deployed).toHaveLength(1);
  expect(mailed).toHaveLength(1);
  expect(mailed[0]).toContain("Approve budget and phase 1 kickoff");
  expect(mailed[0]).toContain("Full text of Problem Brief");
  expect(mailed[0]).toContain("Full text of Approaches");
  expect(mailed[0]).toContain("Full text of Build Plan");
  expect(mailed[0]).toContain("--primary: #2563eb;");
  expect(mailed[0]).toContain('"artifactId": "id-design"');
});

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
          writer: deployment,
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
  const runner = createPackageTools()({
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

    // Re-check and file_package.
    await runner.run(
      { id: "c2", name: "check_deck", arguments: {} },
      new AbortController().signal,
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
  const { workflowBindings } = await import("../config/models.ts");
  const bindings = workflowBindings({ profile: "anthropic_default" });
  expect(bindings.presenter).toEqual(bindings.writer);
  process.env.BUILDER_ROLE_INFERENCE = JSON.stringify(bindings.presenter);
  const entry = await import("../workflows/entries/presenter.ts");
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
