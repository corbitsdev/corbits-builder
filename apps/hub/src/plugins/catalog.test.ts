import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPlugin,
  readPluginFolder,
} from "@corbits-builder/plugin-host/folder";
import {
  InstalledWorkflows,
  roleDeployments,
} from "@corbits-builder/schemas/installed-workflows";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

const deployment = (name: string) => ({
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "dist/workflow.mjs",
  pin: `@corbits-builder/${name}-native@1.0.0-sha-new`,
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
});

test("a plugin added by its folder alone is installed beside the others and its runs resolve to its package", async () => {
  const plugins = await mkdtemp(join(tmpdir(), "hub-plugins-"));
  folders.push(plugins);
  await mkdir(join(plugins, "tester", "src"), { recursive: true });
  await writeFile(join(plugins, "tester", "src", "tester.ts"), "");
  await writeFile(
    join(plugins, "tester", "package.json"),
    JSON.stringify({
      name: "@example/tester",
      builder: {
        roles: [
          {
            name: "tester",
            model: "testing",
            limits: "document",
            called: "the tester",
          },
        ],
        settings: {
          testing: { label: "Tester", hint: "Tests the app.", tier: "low" },
        },
        packages: { tester: { entry: "./src/tester.ts", role: "tester" } },
      },
    }),
  );
  const catalog = await loadCatalog([
    await readPlugin(resolve(import.meta.dir, "../..")),
    ...(await readPluginFolder(
      resolve(import.meta.dir, "../../../../plugins"),
    )),
    ...(await readPluginFolder(plugins)),
  ]);
  const installed = InstalledWorkflows.assert({
    schemaVersion: 3,
    packages: Object.fromEntries(
      [...catalog.packages].map(([name, { declared }]) => [
        name,
        { role: declared.role, deployment: deployment(name) },
      ]),
    ),
  });
  expect(roleDeployments(installed, "tester")).toEqual([deployment("tester")]);
  expect(roleDeployments(installed, "coder")).toEqual([
    deployment("coder"),
    deployment("coder-any-package"),
  ]);
});
