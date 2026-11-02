import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { DeckBundle } from "@corbits-builder/schemas/artifact";
import { unzip } from "@corbits/zip";
import type { TenantEnv } from "@intx/hub-api";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

import { ProjectError } from "../projects/errors.ts";
import {
  DECK_JSON,
  DECK_PDF,
  DECK_PPTX,
  checkDeckInWorkspace,
  createDeckTools,
} from "./deck-tools.ts";
import { mountArtifactRoutes } from "./routes.ts";
import type { createArtifactService } from "./service.ts";

const sampleDeck = {
  theme: {
    colors: {
      primary: "#6D28D9",
      secondary: "#0EA5E9",
      accent: "#F59E0B",
      background: "#FFFFFF",
      text: "#1B1B1F",
      muted: "#6B7280",
    },
    fonts: { heading: "Georgia", body: "Helvetica Neue" },
  },
  footer: { text: "Builder · Deck Tools", slideNumbers: true },
  slides: [
    {
      layout: "title" as const,
      title: "Quarter Review",
      subtitle: "Deterministic slides and PDF",
    },
    {
      layout: "content" as const,
      title: "Key results",
      body: [
        {
          type: "paragraph" as const,
          text: "Every check runs in pure TypeScript.",
        },
        {
          type: "list" as const,
          ordered: true,
          items: [
            "Validate schema",
            "Check overflow and contrast",
            "Render PPTX and PDF",
          ],
        },
      ],
    },
  ],
};

const toolEnv = (toolCwd: string, capabilities?: RuntimeCapabilities) =>
  ({
    toolCwd,
    ...(capabilities ? { capabilities } : {}),
  }) as unknown as Parameters<ReturnType<typeof createDeckTools>>[0];

function createDeckArtifactHarness() {
  const versions = new Map<
    string,
    {
      artifactId: string;
      kind: string;
      title: string;
      version: number;
      sha256: string;
      filedAt: string;
      content: string;
    }
  >();
  let versionSeq = 0;
  const artifactId = "44444444-4444-4444-8444-444444444444";

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
      DeckBundle.assert(JSON.parse(raw.content));
      versionSeq += 1;
      const sha256 = createHash("sha256").update(raw.content).digest("hex");
      const stored = {
        artifactId,
        kind: raw.kind,
        title: raw.title,
        version: versionSeq,
        sha256,
        filedAt: new Date(versionSeq * 1000).toISOString(),
        content: raw.content,
      };
      versions.set(`${artifactId}@${String(versionSeq)}`, stored);
      return {
        artifact: {
          artifactId,
          kind: raw.kind,
          version: versionSeq,
          sha256,
        },
      };
    },
    read: async (
      _actor: unknown,
      _projectId: string,
      raw: { artifactId?: string; version?: number },
    ) => {
      const targetVersion = raw.version ?? versionSeq;
      const stored = versions.get(`${artifactId}@${String(targetVersion)}`);
      if (!stored) throw new ProjectError(404, "artifact_not_found");
      return stored;
    },
  } as unknown as ReturnType<typeof createArtifactService>;

  mountArtifactRoutes(app, service);

  const fetch = async (path: string, init?: RequestInit) => {
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
        role: "writer",
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
    const prefix = "/api/tenants/tenant-1/projects";
    const subPath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    return app.request(subPath, init);
  };

  const capabilities = {
    resolve: () => ({
      resolve: async () => ({ kind: "http", fetch }),
    }),
  } as unknown as RuntimeCapabilities;

  const getArtifactVersion = (id: string, version: number) =>
    versions.get(`${id}@${String(version)}`);

  return { app, capabilities, versions, getArtifactVersion };
}

test("write_deck and check_deck write .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf and file a durable deck artifact on check_deck pass", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-"));
  const { capabilities, versions, getArtifactVersion } =
    createDeckArtifactHarness();
  try {
    const tool = createDeckTools()(toolEnv(workspace, capabilities));
    expect(tool.definitions.map((d) => d.name)).toEqual([
      "write_deck",
      "check_deck",
    ]);

    const writeRes = await tool.run(
      {
        id: "call-1",
        name: "write_deck",
        arguments: { deck: sampleDeck },
      },
      new AbortController().signal,
    );
    expect(writeRes.isError).toBeUndefined();
    const written = JSON.parse(String(writeRes.content));
    expect(written).toEqual({
      slideCount: 2,
      pptxBytes: expect.any(Number),
      pdfBytes: expect.any(Number),
      passed: true,
      issues: [],
    });
    // write_deck alone does not file an artifact version before check_deck passes.
    expect(versions.size).toBe(0);

    const pptxBytes = new Uint8Array(
      await readFile(join(workspace, DECK_PPTX)),
    );
    const pdfBytes = new Uint8Array(await readFile(join(workspace, DECK_PDF)));
    expect(pptxBytes.byteLength).toBe(written.pptxBytes);
    expect(pdfBytes.byteLength).toBe(written.pdfBytes);
    const entries = await unzip(pptxBytes);
    expect(entries.some((e) => e.path === "ppt/slides/slide1.xml")).toBe(true);
    expect(entries.some((e) => e.path === "ppt/slides/slide2.xml")).toBe(true);
    expect(new TextDecoder("latin1").decode(pdfBytes)).toContain(
      "(Quarter Review) Tj",
    );

    const checkRes = await tool.run(
      {
        id: "call-2",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(checkRes.isError).toBeUndefined();
    const checkedBody = JSON.parse(String(checkRes.content));
    expect(checkedBody).toEqual({
      passed: true,
      issues: [],
      artifact: {
        artifactId: "44444444-4444-4444-8444-444444444444",
        kind: "deck",
        version: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });

    // Remove the sidecar workspace completely and verify the filed artifact version remains
    // durable and readable via getArtifactVersion.
    await rm(workspace, { recursive: true, force: true });
    const durable = getArtifactVersion(
      checkedBody.artifact.artifactId,
      checkedBody.artifact.version,
    );
    expect(durable).toBeDefined();
    const bundle = DeckBundle.assert(JSON.parse(durable!.content));
    expect(bundle.deck).toEqual(sampleDeck);
    expect(new Uint8Array(Buffer.from(bundle.pptxBase64, "base64"))).toEqual(
      pptxBytes,
    );
    expect(new Uint8Array(Buffer.from(bundle.pdfBase64, "base64"))).toEqual(
      pdfBytes,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("write_deck and check_deck return isError: true naming the slide and field on validation or check failures", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-err-"));
  const { capabilities, versions } = createDeckArtifactHarness();
  try {
    const tool = createDeckTools()(toolEnv(workspace, capabilities));

    const invalidRes = await tool.run(
      {
        id: "call-bad",
        name: "write_deck",
        arguments: {
          deck: {
            ...sampleDeck,
            slides: [{ layout: "content", body: [] }],
          },
        },
      },
      new AbortController().signal,
    );
    expect(invalidRes.isError).toBe(true);
    const invalidBody = JSON.parse(String(invalidRes.content));
    expect(invalidBody.passed).toBe(false);
    expect(invalidBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].title",
      }),
    ]);

    // Calling write_deck with a check-only failure (valid schema, low contrast) must refuse with
    // isError: true and leave .builder/deck.json, .pptx and .pdf unwritten.
    const lowContrastDeck = {
      ...sampleDeck,
      slides: [
        {
          layout: "content",
          title: "Low contrast slide",
          body: [
            {
              type: "paragraph",
              text: [{ text: "Unreadable light text", color: "#E5E7EB" }],
            },
          ],
        },
      ],
    };
    const writeContrastRes = await tool.run(
      {
        id: "call-write-contrast-fail",
        name: "write_deck",
        arguments: { deck: lowContrastDeck },
      },
      new AbortController().signal,
    );
    expect(writeContrastRes.isError).toBe(true);
    const writeContrastBody = JSON.parse(String(writeContrastRes.content));
    expect(writeContrastBody.passed).toBe(false);
    expect(writeContrastBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);
    expect(await Bun.file(join(workspace, DECK_JSON)).exists()).toBe(false);
    expect(await Bun.file(join(workspace, DECK_PPTX)).exists()).toBe(false);
    expect(await Bun.file(join(workspace, DECK_PDF)).exists()).toBe(false);

    // Seed the failing deck directly on disk to exercise checkDeckInWorkspace and check_deck.
    await mkdir(join(workspace, ".builder"), { recursive: true });
    await writeFile(
      join(workspace, DECK_JSON),
      JSON.stringify(lowContrastDeck),
    );
    const directCheck = await checkDeckInWorkspace(workspace);
    expect(directCheck.passed).toBe(false);

    const checkRes = await tool.run(
      {
        id: "call-check-fail",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(checkRes.isError).toBe(true);
    const checkBody = JSON.parse(String(checkRes.content));
    expect(checkBody.passed).toBe(false);
    expect(checkBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);

    // Also verify missing image asset in .builder/deck.json fails check_deck.
    await mkdir(join(workspace, ".builder"), { recursive: true });
    await writeFile(
      join(workspace, DECK_JSON),
      JSON.stringify({
        ...sampleDeck,
        slides: [
          {
            layout: "image",
            title: "Missing image",
            image: { path: "does-not-exist.png" },
          },
        ],
      }),
    );
    const missingImgRes = await tool.run(
      {
        id: "call-missing-img",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(missingImgRes.isError).toBe(true);
    expect(JSON.parse(String(missingImgRes.content)).issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].image",
      }),
    ]);
    expect(versions.size).toBe(0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
