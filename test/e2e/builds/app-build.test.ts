import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import JSZip from "jszip";
import { createArtifact } from "@corbits/artifacts";
import { startInProcessHub } from "../support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

// A project whose saved app is these files, with values saying how it is built for production.
async function project(
  title: string,
  files: Record<string, string>,
  values: Record<string, unknown>,
) {
  const seeded = await hub.seedProject(title);
  if (Object.keys(values).length > 0)
    await hub.call("POST", `${seeded.path}/values`, { values });
  const content = JSON.stringify({ files });
  await hub.db.transaction((tx) =>
    createArtifact(tx, {
      scope: seeded.person,
      ownerPrincipalId: seeded.person.principalId,
      kind: "app",
      title: "App",
      content,
      source: { origin: "workflow" },
      metadata: { source: "import", bytes: Buffer.byteLength(content) },
    }),
  );
  return seeded;
}

const builtPaths = async (response: Response) => {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
};

// The coder's web-app starter as a project's saved app, the way a first build files it.
async function starterFiles() {
  const root = join(import.meta.dir, "../../../plugins/coder/starter");
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    const full = join(entry.parentPath, entry.name);
    if (
      !entry.isFile() ||
      /(^|\/)(node_modules|dist)\//.test(relative(root, full))
    )
      continue;
    files[relative(root, full)] = await readFile(full, "utf8");
  }
  return files;
}

test("the web-app starter installs and builds as it would for production, and hands back its built client", async () => {
  const { path } = await project("Starter", await starterFiles(), {
    "stack.starter": "web-app",
  });
  const built = await hub.call(
    "GET",
    `${path}/app/build-archive?path=client/dist`,
  );
  const paths = await builtPaths(built);
  expect(paths).toContain("client/dist/index.html");
  expect(
    paths.some((name) => /^client\/dist\/assets\/.+\.js$/.test(name)),
  ).toBe(true);
  expect(paths.every((name) => name.startsWith("client/dist/"))).toBe(true);
}, 600_000);
