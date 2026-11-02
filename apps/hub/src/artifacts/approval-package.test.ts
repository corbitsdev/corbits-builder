import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import type { ApprovalPackageBundle } from "@corbits-builder/schemas/artifact";
import { ProjectError } from "../projects/errors.ts";
import {
  EXCLUDED_PACKAGE_SOURCE_KINDS,
  scanApprovalPackageForSecrets,
  stripApprovalPackageBinaries,
  validateApprovalPackage,
  type StoredPackageSource,
} from "./approval-package.ts";
import { mountArtifactRoutes } from "./routes.ts";
import type { createArtifactService } from "./service.ts";
import { createArtifactTools } from "./tools.ts";

const BRIEF_ID = "11111111-1111-4111-8111-111111111111";
const BRIEF_SHA = "a".repeat(64);
const REQUIREMENTS_ID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENTS_SHA = "b".repeat(64);

function validBundle(
  overrides: Partial<ApprovalPackageBundle> = {},
): ApprovalPackageBundle {
  return {
    manifest: {
      audience: "Product steering committee",
      decisionNeeded: "Approve scope and architecture for version 1",
      tone: "Executive concise",
      length: "5 slides",
      sources: [
        {
          artifactId: BRIEF_ID,
          kind: "problem_brief",
          title: "Problem Brief",
          version: 2,
          sha256: BRIEF_SHA,
        },
        {
          artifactId: REQUIREMENTS_ID,
          kind: "product_requirements",
          title: "Product Requirements",
          version: 1,
          sha256: REQUIREMENTS_SHA,
        },
      ],
    },
    deck: {
      theme: {
        colors: {
          primary: "#6D28D9",
          secondary: "#0EA5E9",
          accent: "#F59E0B",
          background: "#FFFFFF",
          text: "#1B1B1F",
          muted: "#6B7280",
        },
        fonts: { heading: "Georgia", body: "Inter" },
      },
      slides: [
        {
          layout: "title",
          title: "Weather Forecast Hub",
          subtitle: "Approval Package",
          notes: "Walk through key decisions.",
        },
      ],
    },
    pptxBase64: Buffer.from("fake-pptx-binary").toString("base64"),
    pdfBase64: Buffer.from("fake-pdf-binary-data").toString("base64"),
    documents: {
      "executive-summary.md": "# Executive Summary\n\nReady for build.",
    },
    ...overrides,
  };
}

function createFixtureStore() {
  const stored = new Map<string, StoredPackageSource>([
    [`${BRIEF_ID}@2`, { kind: "problem_brief", version: 2, sha256: BRIEF_SHA }],
    [
      `${REQUIREMENTS_ID}@1`,
      {
        kind: "product_requirements",
        version: 1,
        sha256: REQUIREMENTS_SHA,
      },
    ],
  ]);
  const readSource = async (artifactId: string, version: number) =>
    stored.get(`${artifactId}@${String(version)}`);
  return { stored, readSource };
}

function createRouteHarness() {
  const { readSource } = createFixtureStore();
  const filed: { kind: string; title: string; content: string }[] = [];
  const app = new Hono<TenantEnv>();
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code, ...error.details }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("tenant", { id: "tenant-1" } as TenantEnv["Variables"]["tenant"]);
    c.set("principal", {
      id: "principal-1",
    } as TenantEnv["Variables"]["principal"]);
    await next();
  });
  const service = {
    write: async (
      _actor: unknown,
      _projectId: string,
      raw: { kind: string; title: string; content: string },
    ) => {
      if (raw.kind === "approval_package") {
        await validateApprovalPackage(raw.content, readSource);
      }
      filed.push(raw);
      return {
        artifact: {
          artifactId: "33333333-3333-4333-8333-333333333333",
          kind: raw.kind,
          version: filed.length,
          sha256: "c".repeat(64),
        },
      };
    },
  } as unknown as ReturnType<typeof createArtifactService>;
  mountArtifactRoutes(app, service);
  return { app, filed };
}

describe("approval package validation and secret scanning", () => {
  test("files a valid approval_package with matching source version and sha256 cleanly", async () => {
    const { app, filed } = createRouteHarness();
    const bundle = validBundle();
    const response = await app.request("/project-1/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approval_package",
        title: "Q4 Approval Package",
        content: JSON.stringify(bundle),
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      artifact: { kind: string; version: number };
    };
    expect(body.artifact.kind).toBe("approval_package");
    expect(body.artifact.version).toBe(1);
    expect(filed).toHaveLength(1);
  });

  test("refuses stale or mismatched source versions and hashes with invalid_package_source", async () => {
    const { readSource } = createFixtureStore();
    const wrongHash = validBundle({
      manifest: {
        ...validBundle().manifest,
        sources: [
          {
            artifactId: BRIEF_ID,
            kind: "problem_brief",
            title: "Problem Brief",
            version: 2,
            sha256: "f".repeat(64),
          },
        ],
      },
    });
    await expect(
      validateApprovalPackage(wrongHash, readSource),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_package_source",
    });

    const wrongVersion = validBundle({
      manifest: {
        ...validBundle().manifest,
        sources: [
          {
            artifactId: BRIEF_ID,
            kind: "problem_brief",
            title: "Problem Brief",
            version: 99,
            sha256: BRIEF_SHA,
          },
        ],
      },
    });
    await expect(
      validateApprovalPackage(wrongVersion, readSource),
    ).rejects.toMatchObject({
      status: 422,
      code: "invalid_package_source",
    });
  });

  test("fails closed with package_contains_secret naming the file and never leaking the secret value", async () => {
    const { app } = createRouteHarness();
    const secretKey = "sk-ant-api03-secretvalue1234567890abcdef";
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const privateKey = "-----BEGIN RSA PRIVATE KEY-----";

    const withDeckSecret = validBundle({
      deck: {
        slides: [
          {
            layout: "title",
            title: `Leaked key ${secretKey}`,
          },
        ],
      },
      documents: {
        "appendix.md": `Backup key ${awsKey} and ${privateKey}`,
      },
    });

    let caught: ProjectError | undefined;
    try {
      scanApprovalPackageForSecrets(withDeckSecret);
    } catch (error) {
      if (error instanceof ProjectError) caught = error;
      else throw error;
    }
    expect(caught).toBeDefined();
    expect(caught?.status).toBe(422);
    expect(caught?.code).toBe("package_contains_secret");
    expect(caught?.issues).toEqual([
      { path: "deck", message: "api_key" },
      { path: "documents/appendix.md", message: "api_key" },
      { path: "documents/appendix.md", message: "private_key" },
    ]);
    expect(JSON.stringify(caught)).not.toContain(secretKey);
    expect(JSON.stringify(caught)).not.toContain(awsKey);
    expect(JSON.stringify(caught)).not.toContain(privateKey);

    const response = await app.request("/project-1/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approval_package",
        title: "Package with secret",
        content: JSON.stringify(withDeckSecret),
      }),
    });
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).not.toContain(secretKey);
    expect(text).not.toContain(awsKey);
    expect(text).not.toContain(privateKey);
    const parsed = JSON.parse(text) as {
      code: string;
      issues: { path: string; message: string }[];
    };
    expect(parsed.code).toBe("package_contains_secret");
    expect(parsed.issues).toEqual([
      { path: "deck", message: "api_key" },
      { path: "documents/appendix.md", message: "api_key" },
      { path: "documents/appendix.md", message: "private_key" },
    ]);
  });

  test("refuses kind: app or approval_package sources and live-app URLs or demoLogin blocks", async () => {
    const { readSource } = createFixtureStore();
    expect(EXCLUDED_PACKAGE_SOURCE_KINDS.has("app")).toBe(true);
    expect(EXCLUDED_PACKAGE_SOURCE_KINDS.has("approval_package")).toBe(true);

    for (const excludedKind of ["app", "approval_package"]) {
      const withExcludedSource = validBundle({
        manifest: {
          ...validBundle().manifest,
          sources: [
            {
              artifactId: BRIEF_ID,
              kind: excludedKind,
              title: "Excluded",
              version: 1,
              sha256: BRIEF_SHA,
            },
          ],
        },
      });
      await expect(
        validateApprovalPackage(withExcludedSource, readSource),
      ).rejects.toMatchObject({
        status: 422,
        code: "excluded_package_source_kind",
        issues: [{ path: "manifest.sources", message: excludedKind }],
      });
    }

    for (const [forbiddenText, expectedLabel] of [
      ["Connect at http://localhost:3000/app", "live_app_url"],
      ["Internal preview http://127.0.0.1:4173", "live_app_url"],
      ['{"demoLogin":{"email":"admin@example.com"}}', "demo_login"],
    ] as const) {
      const withLiveApp = validBundle({
        documents: { "notes.md": forbiddenText },
      });
      await expect(
        validateApprovalPackage(withLiveApp, readSource),
      ).rejects.toMatchObject({
        status: 422,
        code: "package_contains_secret",
        issues: [{ path: "documents/notes.md", message: expectedLabel }],
      });
    }
  });

  test("read_artifact strips pptxBase64 and pdfBase64 from approval_package content for agents", async () => {
    const bundle = validBundle({
      pptxBase64: Buffer.alloc(12_000, 0x41).toString("base64"),
      pdfBase64: Buffer.alloc(15_000, 0x42).toString("base64"),
    });
    const stripped = JSON.parse(
      stripApprovalPackageBinaries(JSON.stringify(bundle)),
    ) as Record<string, unknown>;
    expect(stripped["pptxBase64"]).toBeUndefined();
    expect(stripped["pdfBase64"]).toBeUndefined();
    expect(stripped["pptxBytes"]).toBe(12_000);
    expect(stripped["pdfBytes"]).toBe(15_000);
    expect(stripped["manifest"]).toEqual(bundle.manifest);

    const fetch = async (path: string) => {
      if (path === "/api/workflow-project-scope") {
        const deployment = {
          source: {
            kind: "asset" as const,
            assetId: "asset-1",
            package: { format: "tarball" as const },
          },
          entry: "dist/index.js",
          pin: "@corbits-builder/writer@0.1.0",
          sourceOfferingIds: ["offering-1"],
          defaultSourceOfferingId: "offering-1",
        };
        return Response.json({
          tenantId: "tenant-1",
          projectId: "project-1",
          domain: "example.invalid",
          role: "coordinator",
          workflows: {
            writer: deployment,
            reviewer: deployment,
            coder: deployment,
            designer: deployment,
          },
          openNetwork: false,
          build: {
            assetDirectory: "/tmp/assets",
            browserCli: "/tmp/browser",
            childPath: "/tmp/child.js",
            dependencyRoots: ["/tmp/deps"],
            ripgrepPath: "/usr/bin/rg",
            runtimeVersion: "1.0.0",
          },
        });
      }
      if (path.endsWith("/artifacts/approval_package")) {
        return Response.json({
          artifactId: "33333333-3333-4333-8333-333333333333",
          kind: "approval_package",
          title: "Approval Package",
          version: 1,
          sha256: "c".repeat(64),
          filedAt: new Date(0).toISOString(),
          content: JSON.stringify(bundle),
        });
      }
      return Response.json({ code: "not_found" }, { status: 404 });
    };
    const capabilities = {
      resolve: () => ({
        resolve: async () => ({ kind: "http", fetch }),
      }),
    } as unknown as RuntimeCapabilities;
    const tool = createArtifactTools("coordinator")({ capabilities } as never);
    const result = await tool.run(
      {
        id: "call-1",
        name: "read_artifact",
        arguments: { kind: "approval_package" },
      },
      new AbortController().signal,
    );
    expect(result.isError).toBeUndefined();
    const contentText = String(result.content);
    expect(contentText.length).toBeLessThan(10_000);
    expect(contentText).not.toContain(bundle.pptxBase64);
    expect(contentText).not.toContain(bundle.pdfBase64);
    const parsedToolOutput = JSON.parse(contentText) as {
      content: string;
    };
    const inner = JSON.parse(parsedToolOutput.content) as {
      pptxBytes: number;
      pdfBytes: number;
    };
    expect(inner.pptxBytes).toBe(12_000);
    expect(inner.pdfBytes).toBe(15_000);
  });
});
