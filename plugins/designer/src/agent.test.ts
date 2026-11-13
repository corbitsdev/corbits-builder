import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createDirectorRegistry,
  createStaticCredentialResolver,
} from "@intx/agent";
import { defineTool } from "@intx/agent/authoring";
import { noopAuditStore, permissiveAuthorize } from "@intx/agent/testing";
import { createDefaultScheduler } from "@intx/inference";
import { createBuiltinRegistry } from "@intx/inference/providers";
import { createIsogitStore } from "@intx/storage-isogit/node";
import { posix } from "@intx/tools-posix/sidecar-bundle";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import { readDesignDraft } from "@corbits-builder/hub/artifacts/design-draft";
import { createDesignTools } from "@corbits-builder/hub/artifacts/design-tools";
import {
  CHECK_DESIGN_TOOL,
  checkDesignDefinition,
  createDesignCheck,
  touchesDesigns,
} from "@corbits-builder/hub/builds/design-check";
import {
  designPath,
  type CodingSidecarEnv,
} from "@corbits-builder/hub/builds/sidecar-tools";
import {
  prepareWorkspace,
  syncDesignScreensOnDisk,
} from "@corbits-builder/hub/builds/starter";
import { CATALOG } from "@corbits-builder/hub/plugins/catalog";
import { compactingDirector } from "@corbits-builder/hub/workflows/director";
import {
  dropDegenerateTurn,
  trimHistory,
} from "@corbits-builder/hub/workflows/compaction";
import { createDesignerAgent } from "./agent.ts";
import { designStarterFiles, designThemes } from "./skills.ts";

const STARTER = designStarterFiles();
const MODERN_SLEEK = designThemes()["modern-sleek"]!;

test("designer agent writes per-screen files, is held by checkBeforeDone until checked, and files the bundle", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "sb-designer-e2e-")),
  );
  const workspace = join(root, "workspace");
  const workdir = join(root, "agent");
  await mkdir(workspace, { recursive: true });
  await mkdir(workdir, { recursive: true });
  await prepareWorkspace(CATALOG.role("designer")!, workspace, async (kind) =>
    kind === "requirements"
      ? {
          artifactId: "req-1",
          kind: "requirements",
          title: "Requirements",
          version: 1,
          sha256: "b".repeat(64),
          filedAt: "2026-11-01T00:00:00.000Z",
          content:
            "## Interface requirements\n\n- IR-1: Overview screen\n- IR-2: Orders screen\n",
        }
      : undefined,
  );
  const check = createDesignCheck(workspace, async () => ({
    exitCode: 0,
    output:
      "check passed: served .builder/designs and opened /, /#/overview, /#/orders at 1280 and 390 px with no errors",
  }));
  const designCodingTools = defineTool<CodingSidecarEnv>({
    id: "@corbits-builder/coding/test-design",
    requires: ["toolCwd"],
    definitions: [
      { name: "read_file" },
      { name: "write_file" },
      { name: "edit_file" },
      { name: "grep" },
      { name: CHECK_DESIGN_TOOL },
    ],
    factory: (env) => {
      const native = posix(env);
      return {
        definitions: [
          ...native.definitions.filter((tool) =>
            ["read_file", "write_file", "edit_file", "grep"].includes(
              tool.name,
            ),
          ),
          checkDesignDefinition,
        ],
        run: async (rawCall, signal) => {
          const rawPath = rawCall.arguments?.["path"];
          const call =
            typeof rawPath === "string"
              ? {
                  ...rawCall,
                  arguments: {
                    ...rawCall.arguments,
                    path: designPath(rawPath),
                  },
                }
              : rawCall;
          if (call.name === CHECK_DESIGN_TOOL) {
            await syncDesignScreensOnDisk(workspace);
            const { checklist } = await check.current(signal);
            return { callId: call.id, content: checklist };
          }
          const result = await native.run(call, signal);
          const path = call.arguments?.["path"];
          if (
            !result.isError &&
            typeof path === "string" &&
            touchesDesigns(workspace, path)
          )
            await syncDesignScreensOnDisk(workspace);
          return result;
        },
        dispose: async () => {
          await native.dispose?.();
        },
      };
    },
  });

  const deployment = {
    source: {
      kind: "asset" as const,
      assetId: "asset",
      package: { format: "tarball" as const },
    },
    entry: "entry",
    pin: "@corbits-builder/designer@1.0.0",
    sourceOfferingIds: ["offering"],
    defaultSourceOfferingId: "offering",
  };
  let filedBody: { kind: string; title: string; content: string } | undefined;
  const hubFetch = async (path: string, init: RequestInit) => {
    if (path === "/api/workflow-project-scope")
      return Response.json({
        tenantId: "tenant",
        projectId: "project",
        domain: "example.invalid",
        role: "designer",
        workflows: {
          "writer-product-requirements": deployment,
          "writer-build-plan": deployment,
          "writer-document": deployment,
          reviewer: deployment,
          coder: deployment,
          designer: deployment,
        },
        openNetwork: false,
        build: {
          assetDirectory: "/assets",
          browserCli: "/browser",
          childPath: "/child",
          dependencyRoots: ["/deps"],
          ripgrepPath: "/rg",
          runtimeVersion: "1.0.0",
        },
      });
    if (path === "/api/tenants/tenant/projects/project/artifacts") {
      filedBody = JSON.parse(String(init.body)) as {
        kind: string;
        title: string;
        content: string;
      };
      return Response.json({
        artifact: {
          artifactId: "design-1",
          kind: "design_option",
          title: filedBody.title,
          version: 1,
          sha256: "a".repeat(64),
        },
      });
    }
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
  const capabilities = {
    resolve: () => ({
      resolve: async () => ({ kind: "http", fetch: hubFetch }),
    }),
  } as unknown as RuntimeCapabilities;

  const compacting = compactingDirector("@corbits-builder/designer-test");
  const historyCompactor = trimHistory(160_000);
  const definition = createDesignerAgent<CodingSidecarEnv>({
    id: "designer",
    role: "designer",
    director: compacting.build({
      contextWindow: 200_000,
      compactAt: 0.6,
      checkBeforeDone: true,
      timeouts: {},
    }),
    standards: [],
    inference: { provider: "anthropic", model: "claude-sonnet-4-6" },
    tools: [createDesignTools("designer"), designCodingTools],
  });

  const shell = STARTER[".builder/designs/index.html"]!.replaceAll(
    "#/home",
    "#/overview",
  );
  const conversations: string[] = [];
  const scriptedTurns = [
    [
      {
        type: "tool_use",
        id: "call-shell",
        name: "write_file",
        input: { path: "designs/index.html", content: shell },
      },
      {
        type: "tool_use",
        id: "call-overview",
        name: "write_file",
        input: {
          path: "designs/screens/overview.html",
          content:
            '<section data-screen="overview"><div data-state="populated"><h1>Overview</h1></div></section>',
        },
      },
      {
        type: "tool_use",
        id: "call-orders",
        name: "write_file",
        input: {
          path: "designs/screens/orders.html",
          content:
            '<section data-screen="orders"><div data-state="populated"><h1>Orders</h1></div></section>\n<dialog class="dialog" id="new-order-dialog"></dialog>',
        },
      },
      {
        type: "tool_use",
        id: "call-doc",
        name: "write_file",
        input: { path: "DESIGN.md", content: MODERN_SLEEK["DESIGN.md"]! },
      },
    ],
    [{ type: "text", text: "Premature reply before checking or filing." }],
    [
      {
        type: "tool_use",
        id: "call-check",
        name: CHECK_DESIGN_TOOL,
        input: {},
      },
      {
        type: "tool_use",
        id: "call-file",
        name: "file_design_option",
        input: {},
      },
    ],
    [{ type: "text", text: "Filed the two-screen order desk design." }],
  ];
  let turnIndex = 0;
  const storage = await createIsogitStore(workdir);
  const agent = await createAgent(definition, {
    sources: [
      {
        id: "anthropic:claude-sonnet-4-6",
        provider: "anthropic",
        baseURL: "https://api.anthropic.invalid",
        credentialId: "test-key",
        model: "claude-sonnet-4-6",
      },
    ],
    defaultSource: "anthropic:claude-sonnet-4-6",
    storage,
    workdir,
    audit: noopAuditStore(),
    authorize: permissiveAuthorize(),
    directors: createDirectorRegistry({
      factories: [compacting.factory],
      defaultId: compacting.factory.id,
    }),
    compactors: {
      [dropDegenerateTurn.name]: dropDegenerateTurn,
      [historyCompactor.name]: historyCompactor,
    },
    readCurrentMaterial: createStaticCredentialResolver({
      "test-key": "sk-test",
    }),
    deps: {
      scheduler: createDefaultScheduler(),
      adapters: createBuiltinRegistry(),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          system?: string | { text?: string }[];
          messages?: unknown;
        };
        conversations.push(JSON.stringify(body.messages));
        const system = body.system;
        let systemText: string | undefined;
        if (Array.isArray(system)) {
          systemText = system
            .flatMap((part) =>
              typeof part.text === "string" ? [part.text] : [],
            )
            .join("\n");
        } else if (typeof system === "string") {
          systemText = system;
        }
        if (systemText === undefined) throw new Error("missing_system_prompt");
        const content = scriptedTurns[turnIndex++];
        if (!content) throw new Error("unexpected_inference_turn");
        return Response.json({
          type: "message",
          content,
          usage: { input_tokens: 120, output_tokens: 60 },
        });
      },
    },
    toolCwd: workspace,
    capabilities,
  });

  try {
    const sent = await agent.send("Design the order desk mockup.");
    expect(sent).toMatchObject({
      type: "reply",
      reply: "Filed the two-screen order desk design.",
    });
    expect(turnIndex).toBe(4);
    // The held reply stays in the conversation, answered by the director's note.
    expect(conversations[2]).toContain(
      "Premature reply before checking or filing.",
    );
    expect(conversations[2]).toContain(
      "Files changed after the last passing check, so the work is not done yet.",
    );

    const draft = await readDesignDraft(workspace);
    expect(draft?.["designs/screens/home.html"]).toBeUndefined();
    expect(draft?.["designs/index.html"]).toContain(
      "<!-- builder:screens:start -->",
    );
    expect(draft?.["designs/index.html"]).toContain('data-screen="overview"');
    expect(draft?.["designs/index.html"]).toContain('data-screen="orders"');
    expect(draft?.["designs/screens/overview.html"]).toContain(
      'data-screen="overview"',
    );
    expect(draft?.["designs/screens/orders.html"]).toContain(
      'data-screen="orders"',
    );

    const diskIndex = await readFile(
      join(workspace, ".builder", "designs", "index.html"),
      "utf8",
    );
    expect(diskIndex).toContain("<!-- builder:screens:start -->");
    expect(diskIndex).toContain('data-screen="overview"');
    expect(diskIndex).toContain('data-screen="orders"');
    expect(diskIndex).toContain("<!-- builder:screens:end -->");

    const parsed = DesignBundle.assert(JSON.parse(filedBody!.content));
    expect(parsed.files["designs/screens/home.html"]).toBeUndefined();
    expect(parsed.files["designs/index.html"]).toContain(
      "<!-- builder:screens:start -->",
    );
    expect(parsed.files["designs/screens/overview.html"]).toContain(
      'data-screen="overview"',
    );
    expect(parsed.files["designs/screens/orders.html"]).toContain(
      'id="new-order-dialog"',
    );
    expect(parsed.files["DESIGN.md"]).toContain("colors:");
  } finally {
    await agent.close();
    check.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
