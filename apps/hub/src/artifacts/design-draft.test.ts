import { describe, expect, test } from "bun:test";
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
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { DesignBundle } from "@corbits-builder/schemas/artifact";
import { createDesignSubmission } from "../builds/design-submission.ts";
import {
  spliceDesignScreens,
  syncDesignScreensOnDisk,
} from "../builds/starter.ts";
import { CATALOG } from "../plugins/catalog.ts";
import {
  designDraftOf,
  readDesignBundle,
  readDesignDraft,
  manualPictureRefs,
  manualPictures,
} from "./design-draft.ts";
import { MAX_DESIGN_BYTES } from "../config/design.ts";
import { fileDesignOption } from "./design-tools.ts";

const DESIGN = CATALOG.design!;
const STARTER = DESIGN.starter;
const MODERN_SLEEK = DESIGN.themes.get("modern-sleek")!;

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
      "designs/index.html": spliceDesignScreens(
        STARTER[".builder/designs/index.html"]!,
        { "list.html": '<section data-screen="list"><h1>List</h1></section>' },
      ),
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
      "designs/index.html": spliceDesignScreens("<p>mockup</p>", {
        "list.html": "<p>list</p>",
      }),
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

// check_design against a hub that files whatever it is sent.
function designTools(
  workspace: string,
  onFile: (body: { kind: string; title: string; content: string }) => void,
) {
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
  const fetch = async (path: string, init: RequestInit) => {
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
        firstBuild: false,
        toolchains: { paths: [], dataDir: "/unused" },
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
      const filedBody = JSON.parse(String(init.body)) as {
        kind: string;
        title: string;
        content: string;
      };
      onFile(filedBody);
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
  return createDesignSubmission(
    workspace,
    async () => ({ exitCode: 0, output: "check passed: opened all screens" }),
    (submission, signal) =>
      fileDesignOption(capabilities, "designer", submission, signal),
  );
}

test("check_design packs per-screen files and drops the untouched starter home screen", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "sb-design-file-")),
  );
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

    let filedBody: { kind: string; title: string; content: string } | undefined;
    const tools = designTools(workspace, (body) => {
      filedBody = body;
    });
    const result = await tools.run(
      { id: "call-1", name: "check_design", arguments: {} },
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
    await rm(workspace, { recursive: true, force: true });
  }
});

test("check_design files a design past the old 256 KiB cap and refuses one over the limit, naming its largest file", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "sb-design-size-")),
  );
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
    const data = join(workspace, ".builder", "designs", "data.txt");
    await writeFile(data, "é".repeat(160_000));
    const filed: string[] = [];
    const tools = createDesignSubmission(
      workspace,
      async () => ({ exitCode: 0, output: "check passed: opened all screens" }),
      async (submission) => {
        filed.push(submission.content);
        return {
          artifact: {
            artifactId: "design-1",
            kind: "design_option",
            version: filed.length,
            sha256: "a".repeat(64),
          },
        };
      },
    );
    const check = () =>
      tools.run(
        { id: "call", name: "check_design", arguments: {} },
        new AbortController().signal,
      );

    expect((await check()).detail).toEqual({ checkPassed: true, filed: true });
    expect(Buffer.byteLength(filed[0]!)).toBeGreaterThan(256 * 1024);

    await writeFile(data, "é".repeat(MAX_DESIGN_BYTES / 2));
    const oversized = await check();
    expect(oversized.detail).toEqual({ checkPassed: false, filed: false });
    expect(oversized.content).toContain("design_too_large:");
    expect(oversized.content).toContain(`limit is ${MAX_DESIGN_BYTES} bytes`);
    expect(oversized.content).toContain(
      `designs/data.txt (${MAX_DESIGN_BYTES} bytes)`,
    );
    expect(oversized.content).toContain("run check_design again");
    expect(filed).toHaveLength(1);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("a draft over the limit is refused, naming its largest file and what a designer starts from instead", () => {
  const files = {
    "DESIGN.md": "# Design",
    "designs/index.html": "x".repeat(MAX_DESIGN_BYTES),
  };
  expect(() =>
    designDraftOf(
      files,
      "A new design task starts from the filed design instead.",
    ),
  ).toThrow(
    expect.objectContaining({
      code: "design_draft_too_large",
      details: expect.objectContaining({
        hint: expect.stringMatching(
          /^The draft cannot be loaded\. The design is \d+ bytes; .*Largest files: designs\/index\.html \(\d+ bytes\).*starts from the filed design instead\.$/,
        ),
      }),
    }),
  );
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
    "../../../../packages/app-checks/check/check-app.ts",
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

test("readDesignDraft serves spliced index.html whether synced on disk or packed on read", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sb-design-sync-"));
  const designs = join(workspace, ".builder", "designs");
  try {
    for (const [path, text] of Object.entries(STARTER)) {
      const target = join(workspace, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
    }
    await syncDesignScreensOnDisk(workspace);
    expect(await readDesignDraft(workspace)).toBeUndefined();

    await writeFile(
      join(designs, "screens", "place.html"),
      '<section data-screen="place"><h1>Places</h1></section>',
    );
    const beforeSync = await readDesignDraft(workspace);
    await syncDesignScreensOnDisk(workspace);
    const afterSync = await readDesignDraft(workspace);

    expect(afterSync).toEqual(beforeSync);
    expect(afterSync?.["designs/screens/home.html"]).toBeUndefined();
    expect(afterSync?.["designs/index.html"]).toContain(
      "<!-- builder:screens:start -->",
    );
    expect(afterSync?.["designs/index.html"]).toContain('data-screen="place"');
    expect(afterSync?.["designs/index.html"]).not.toContain("Hello, world");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

describe("user manual pictures", () => {
  const markdown = [
    "# Using the app",
    "![The home page](manual/home.png)",
    '![Adding a card](manual/board.new-card.png "highlight: button | New card")',
    '<img src="manual/settings.png" alt="Settings">',
    "![Not ours](../secret.png)",
    "![Elsewhere](https://example.com/x.png)",
    "![Again](manual/home.png)",
  ].join("\n");
  test("reads each picture under docs/manual/ once, as the manual names it", () => {
    expect(manualPictureRefs(markdown)).toEqual([
      "manual/home.png",
      "manual/board.new-card.png",
      "manual/settings.png",
    ]);
  });
  test("carries the pictures it can find as data URLs of their kind", () => {
    const bytes = new TextEncoder().encode("png-bytes");
    const pictures = manualPictures(markdown, (ref) =>
      ref === "manual/settings.png" ? undefined : bytes,
    );
    expect(Object.keys(pictures)).toEqual([
      "manual/home.png",
      "manual/board.new-card.png",
    ]);
    expect(pictures["manual/home.png"]).toBe(
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    );
  });
});
