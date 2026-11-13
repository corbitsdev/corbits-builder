import { expect, test } from "bun:test";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import type {
  ListAssetBlobsParams,
  PopulateAssetParams,
} from "@intx/hub-sessions";
import { type } from "arktype";
import {
  declaredRun,
  STARTERS,
  starterValues,
} from "@corbits-builder/coder/contract";
import { WORKFLOW_PACKAGES } from "../plugins/catalog.ts";
import {
  appRepositoryMain,
  coderToolEffects,
  seedStarter,
} from "./app-repository.ts";

const author = { name: "Builder", email: "builder@example.com" };

test("an app repository's main reads as the app a snapshot would file, once it holds one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb-app-repository-"));
  try {
    await git.init({ fs, dir, defaultBranch: "main" });
    const commit = async (files: Record<string, string | Uint8Array>) => {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(dir, path)), { recursive: true });
        await writeFile(join(dir, path), content);
        await git.add({ fs, dir, filepath: path });
      }
      return git.commit({ fs, dir, message: "Edit", author });
    };
    const genesis = await commit({ ".gitignore": "node_modules/\n" });
    const atGenesis = await appRepositoryMain(dir);
    expect(atGenesis.commit).toBe(genesis);
    expect(await atGenesis.read()).toBeUndefined();

    const head = await commit({
      "package.json": "{}",
      "src/main.tsx": "export {};\n",
      "public/logo.png": new Uint8Array([0x89, 0x50, 0xff, 0xfe]),
      "node_modules/react/index.js": "module.exports = {};\n",
      ".builder/DESIGN.md": "# Design\n",
      "server/.env.local": "SECRET=1\n",
    });
    const main = await appRepositoryMain(dir);
    expect(main.commit).toBe(head);
    const app = await main.read();
    expect(Object.keys(app!.bundle.files).sort()).toEqual([
      ".gitignore",
      "package.json",
      "src/main.tsx",
    ]);
    expect(app!.bundle.binary).toEqual({ "public/logo.png": "iVD//g==" });
    expect(JSON.parse(app!.content)).toEqual(app!.bundle);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// An app repository's main as Interchange's asset service reads and writes it, from its genesis.
function appAsset() {
  const main = new Map<string, string | Uint8Array>([[".gitignore", ""]]);
  return {
    main,
    listAssetBlobs: async ({ dir }: ListAssetBlobsParams) =>
      [...main.keys()].filter((path) => dir === "" && !path.includes("/")),
    populateAsset: async ({ tree }: PopulateAssetParams) => {
      for (const [path, content] of Object.entries(tree.files))
        main.set(path, content);
      return { commitSha: "seeded" };
    },
  };
}

test("the coder is one package that knows no starter, and the hub writes a first build's starter onto main", async () => {
  expect(
    [...WORKFLOW_PACKAGES]
      .filter(([, role]) => role === "coder")
      .map(([name]) => name),
  ).toEqual(["coder"]);

  const fresh = appAsset();
  await seedStarter(fresh, "asset", "web-app");
  expect([...fresh.main.keys()]).toEqual(
    expect.arrayContaining(["AGENTS.md", "CHECKS.txt", "package.json"]),
  );
  expect(
    [...fresh.main.keys()].some((path) => path.startsWith("client/")),
  ).toBe(true);

  const built = appAsset();
  built.main.set("main.ts", "export {};\n");
  await seedStarter(built, "asset", "bare");
  expect([...built.main.keys()]).toEqual([".gitignore", "main.ts"]);
});

test("a project serves a web app by its stack.run, whatever it started from", () => {
  // A first build from the web starter saves the starter's run as the project's stack.run.
  expect(starterValues("web-app")).toMatchObject({
    "stack.starter": "web-app",
    "stack.run": STARTERS["web-app"].run,
  });
  expect(declaredRun(starterValues("web-app"))).toEqual(
    STARTERS["web-app"].run,
  );
  expect(declaredRun(starterValues("bare"))).toBeUndefined();
  expect(declaredRun(starterValues(null))).toBeUndefined();

  // Code that began from no starter serves the app its coder reported.
  const reported = { command: "python3 -m http.server $PORT", port: "PORT" };
  expect(declaredRun({ "stack.run": reported })).toEqual(reported);
  expect(declaredRun({ "stack.checks": "make test" })).toBeUndefined();
  expect(
    declaredRun({ "stack.run": { command: "make serve" } }),
  ).toBeInstanceOf(type.errors);
});

test("a coder run installs any package without asking only when its person turned that on", () => {
  expect(coderToolEffects({ install_any_package: "yes" })).toEqual([
    { tool: "install_packages", effect: "allow" },
  ]);
  expect(coderToolEffects({ install_any_package: "no" })).toEqual([]);
  expect(coderToolEffects(null)).toEqual([]);
});
