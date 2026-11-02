import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { createDesignerAgent } from "@corbits-builder/designer/agent";
import {
  designStarterFiles,
  designThemes,
} from "@corbits-builder/designer/skills" with { type: "macro" };
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import {
  CHECK_DESIGN_TOOL,
  checkDesignDefinition,
  createDesignCheck,
  touchesDesigns,
} from "../builds/design-check.ts";
import { designPath, type CodingSidecarEnv } from "../builds/sidecar-tools.ts";
import { prepareWorkspace } from "../builds/starter.ts";
import {
  compactingDirector,
  dropDegenerateTurn,
  trimHistory,
} from "../workflows/compaction.ts";
import { readDesignBundle, readDesignDraft } from "./design-draft.ts";
import { createDesignTools } from "./design-tools.ts";

const STARTER = designStarterFiles();
const MODERN_SLEEK = designThemes()["modern-sleek"]!;

test("the draft serves only regular files inside .builder/designs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sb-design-draft-"));
  const workspace = join(root, "workspace");
  const designs = join(workspace, ".builder", "designs");
  const outside = join(root, "home");
  try {
    for (const [path, text] of Object.entries(STARTER)) {
      const target = join(workspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    expect(await readDesignDraft(workspace)).toBeUndefined();

    await writeFile(
      join(designs, "screens", "list.html"),
      '<section data-screen="list"><h1>List</h1></section>',
    );
    expect(await readDesignDraft(workspace)).toEqual({
      "designs/index.html": STARTER[".builder/designs/index.html"]!,
      "designs/screens/list.html":
        '<section data-screen="list"><h1>List</h1></section>',
      "designs/styles.css": STARTER[".builder/designs/styles.css"]!,
    });

    await rm(join(designs, "screens", "home.html"));
    await rm(join(designs, "styles.css"));
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await writeFile(join(outside, "index.html"), "<p>outside</p>");
    await writeFile(join(workspace, ".builder", "DESIGN.md"), "# Design\n");
    await writeFile(join(workspace, "package.json"), "{}");
    await writeFile(join(designs, "index.html"), "<p>mockup</p>");
    await writeFile(join(designs, "screens", "list.html"), "<p>list</p>");
    await writeFile(join(designs, ".env"), "SECRET=1\n");
    await symlink(join(outside, "secret.txt"), join(designs, "secret.txt"));
    await symlink(outside, join(designs, "home"));
    expect(await readDesignDraft(workspace)).toEqual({
      "designs/index.html": "<p>mockup</p>",
      "designs/screens/list.html": "<p>list</p>",
    });

    await rm(designs, { recursive: true });
    await symlink(outside, designs);
    expect(await readDesignDraft(workspace)).toBeUndefined();

    await rm(join(workspace, ".builder"), { recursive: true });
    await mkdir(join(outside, "designs"));
    await writeFile(join(outside, "designs", "index.html"), "<p>outside</p>");
    await symlink(outside, join(workspace, ".builder"));
    expect(await readDesignDraft(workspace)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file_design_option packs per-screen files and drops the untouched starter home screen", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "sb-design-file-")),
  );
  const check = createDesignCheck(workspace, async () => ({
    exitCode: 0,
    output:
      "check passed: served .builder/designs and opened /, /#/overview, /#/orders at 1280 and 390 px with no errors",
  }));
  try {
    for (const [path, text] of Object.entries(STARTER)) {
      const target = join(workspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      MODERN_SLEEK["DESIGN.md"]!,
    );
    await writeFile(
      join(workspace, ".builder", "designs", "styles.css"),
      MODERN_SLEEK["designs/styles.css"]!,
    );
    await writeFile(
      join(workspace, ".builder", "designs", "screens", "overview.html"),
      '<section data-screen="overview"><div data-state="populated"><h1>Overview</h1></div></section>',
    );
    await writeFile(
      join(workspace, ".builder", "designs", "screens", "orders.html"),
      '<section data-screen="orders"><div data-state="populated"><h1>Orders</h1></div></section>\n<dialog class="dialog" id="new-order-dialog"></dialog>\n<div class="toast" id="shipped-toast" data-open="false">Shipped</div>',
    );

    const bundle = await readDesignBundle(workspace);
    expect(bundle?.["designs/screens/home.html"]).toBeUndefined();
    expect(bundle?.["designs/screens/overview.html"]).toContain(
      'data-screen="overview"',
    );
    expect(bundle?.["designs/screens/orders.html"]).toContain(
      'data-screen="orders"',
    );

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
    const fetch = async (path: string, init: RequestInit) => {
      if (path === "/api/workflow-project-scope")
        return Response.json({
          tenantId: "tenant",
          projectId: "project",
          domain: "example.invalid",
          role: "designer",
          workflows: {
            writer: deployment,
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
      resolve: () => ({ resolve: async () => ({ kind: "http", fetch }) }),
    } as unknown as RuntimeCapabilities;
    const tools = createDesignTools()({
      toolCwd: workspace,
      capabilities,
    } as never);
    const result = await tools.run(
      { id: "call-1", name: "file_design_option", arguments: {} },
      new AbortController().signal,
    );
    expect(result.isError).toBeUndefined();
    expect(filedBody?.kind).toBe("design_option");
    const parsed = DesignBundle.assert(JSON.parse(filedBody!.content));
    expect(parsed.files["designs/screens/home.html"]).toBeUndefined();
    expect(parsed.files["designs/screens/overview.html"]).toContain(
      'data-screen="overview"',
    );
    expect(parsed.files["designs/screens/orders.html"]).toContain(
      'id="new-order-dialog"',
    );
    expect(parsed.files["DESIGN.md"]).toContain("colors:");
  } finally {
    check.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("check-app serves a per-screen mockup in the headless browser and checks every screen", async () => {
  const browserCache = join(
    homedir(),
    ".cache",
    "corbits-builder",
    "browsers",
    "156.0.8078.4",
  );
  let hasBrowser = false;
  try {
    hasBrowser = (await stat(browserCache)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!hasBrowser) return;

  const root = await realpath(await mkdtemp(join(tmpdir(), "sb-check-app-")));
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const checkApp = resolve(
    import.meta.dir,
    "../../../../workflows/coder/check/check-app.ts",
  );
  try {
    await mkdir(home, { recursive: true });
    await symlink(browserCache, join(home, "browsers"));
    for (const [path, text] of Object.entries(STARTER)) {
      const target = join(workspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    const shell = STARTER[".builder/designs/index.html"]!.replaceAll(
      "#/home",
      "#/overview",
    ).replace(
      '<a href="#/overview" data-testid="nav-home-link">Home</a>',
      '<a href="#/overview" data-testid="nav-overview-link">Overview</a>\n          <a href="#/orders" data-testid="nav-orders-link">Orders</a>',
    );
    const overviewScreen = [
      '<section data-screen="overview" data-testid="screen-overview">',
      '  <div data-state="populated" data-testid="overview-populated">',
      '    <div class="screen-header">',
      '      <h1 data-testid="overview-title">Good morning, Ines</h1>',
      '      <a class="button" href="#/orders" data-testid="overview-orders-button">Review orders</a>',
      "    </div>",
      "  </div>",
      "</section>",
    ].join("\n");
    const ordersScreen = [
      '<section data-screen="orders" data-testid="screen-orders">',
      '  <div data-state="populated" data-testid="orders-populated">',
      '    <div class="screen-header">',
      '      <h1 data-testid="orders-title">Orders</h1>',
      '      <button type="button" class="button" data-open="new-order-dialog" data-testid="orders-new-button">New order</button>',
      "    </div>",
      '    <button type="button" class="button button-outline" data-toast="shipped-toast" data-testid="orders-ship-button">Mark as shipped</button>',
      "  </div>",
      '  <div data-state="empty" data-testid="orders-empty">',
      "    <h1>No orders yet</h1>",
      "  </div>",
      "</section>",
      '<dialog class="dialog" id="new-order-dialog" data-testid="orders-new-dialog">',
      '  <form class="form" method="dialog">',
      "    <h2>New order</h2>",
      '    <button type="button" class="button button-ghost" data-close>Cancel</button>',
      '    <button type="submit" class="button">Save order</button>',
      "  </form>",
      "</dialog>",
      '<div class="toast" id="shipped-toast" role="status" data-open="false">Order marked as shipped.</div>',
    ].join("\n");

    await writeFile(
      join(workspace, ".builder", "designs", "index.html"),
      shell,
    );
    await writeFile(
      join(workspace, ".builder", "designs", "styles.css"),
      MODERN_SLEEK["designs/styles.css"]!,
    );
    await writeFile(
      join(workspace, ".builder", "designs", "screens", "overview.html"),
      overviewScreen,
    );
    await writeFile(
      join(workspace, ".builder", "designs", "screens", "orders.html"),
      ordersScreen,
    );
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      `${MODERN_SLEEK["DESIGN.md"]!}\n- Requirements: IR-1, IR-2\n`,
    );
    await mkdir(join(workspace, ".inputs"), { recursive: true });
    await writeFile(
      join(workspace, ".inputs", "requirements.md"),
      "## Interface requirements\n\n- IR-1: Overview screen\n- IR-2: Orders screen\n",
    );

    const run = Bun.spawn(
      [process.execPath, checkApp, join(workspace, ".builder", "designs")],
      {
        cwd: workspace,
        env: { ...process.env, HOME: home },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output =
      (await new Response(run.stdout).text()) +
      (await new Response(run.stderr).text());
    expect(output).toContain("check passed:");
    expect(output).toContain("/#/overview");
    expect(output).toContain("/#/orders");
    expect(await run.exited).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("designer agent writes per-screen files, is held by checkBeforeDone until checked, and files the bundle", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "sb-designer-e2e-")),
  );
  const workspace = join(root, "workspace");
  const workdir = join(root, "agent");
  await mkdir(workspace, { recursive: true });
  await mkdir(workdir, { recursive: true });
  await prepareWorkspace("design", workspace, async (kind) =>
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
            check.changed();
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
          writer: deployment,
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
    director: compacting.build({
      contextWindow: 200_000,
      compactAt: 0.6,
      checkBeforeDone: true,
    }),
    standards: [],
    inference: { provider: "anthropic", model: "claude-sonnet-4-6" },
    tools: [createDesignTools(), designCodingTools],
  });

  const shell = STARTER[".builder/designs/index.html"]!.replaceAll(
    "#/home",
    "#/overview",
  );
  const systemPrompts: string[] = [];
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
        };
        const systemText = Array.isArray(body.system)
          ? body.system.map((part) => part.text ?? "").join("\n")
          : String(body.system ?? "");
        systemPrompts.push(systemText);
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
    expect(systemPrompts[0]).toContain("designs/screens/<name>.html");
    expect(systemPrompts[2]).toContain(
      "Files changed after the last passing check-app, so the work is not done yet.",
    );

    const draft = await readDesignDraft(workspace);
    expect(draft?.["designs/screens/home.html"]).toBeUndefined();
    expect(draft?.["designs/screens/overview.html"]).toContain(
      'data-screen="overview"',
    );
    expect(draft?.["designs/screens/orders.html"]).toContain(
      'data-screen="orders"',
    );

    const parsed = DesignBundle.assert(JSON.parse(filedBody!.content));
    expect(parsed.files["designs/screens/home.html"]).toBeUndefined();
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
