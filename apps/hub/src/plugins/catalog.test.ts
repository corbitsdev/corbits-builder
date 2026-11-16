import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import {
  readPlugin,
  readPluginFolder,
} from "@corbits-builder/plugin-host/folder";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
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
            ended: {
              failed: "Stopped.",
              cancelled: "Cancelled.",
              task: "The tester",
            },
          },
        ],
        settings: {
          testing: { label: "Tester", hint: "Tests the app.", tier: "low" },
        },
        packages: { tester: { entry: "./src/tester.ts", role: "tester" } },
      },
    }),
  );
  const catalog = await loadCatalog(
    [
      await readPlugin(resolve(import.meta.dir, "../..")),
      ...(await readPluginFolder(
        resolve(import.meta.dir, "../../../../plugins"),
      )),
      ...(await readPluginFolder(plugins)),
    ],
    new Set(["install_any_package"]),
  );
  const playing = (role: string) =>
    [...catalog.packages]
      .filter(([, brought]) => brought.role === role)
      .map(([name]) => name);
  expect(playing("tester")).toEqual(["tester"]);
  expect(playing("coder")).toEqual(["coder", "coder-any-package"]);
});
