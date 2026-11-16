import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCatalog } from "./catalog.ts";
import { readPluginFolder } from "./folder.ts";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

async function pluginsFolder(builder: unknown) {
  const plugins = await mkdtemp(join(tmpdir(), "plugin-host-"));
  folders.push(plugins);
  await mkdir(join(plugins, "tester", "src"), { recursive: true });
  await writeFile(join(plugins, "tester", "src", "tester.ts"), "");
  await writeFile(
    join(plugins, "tester", "package.json"),
    JSON.stringify({ name: "@example/tester", builder }),
  );
  return plugins;
}

const tester = {
  name: "tester",
  model: "testing",
  limits: "document",
  called: "the tester",
};
const roles = [tester];
const settings = {
  testing: { label: "Tester", hint: "Tests the app.", tier: "low" },
};
const packages = { tester: { entry: "./src/tester.ts", role: "tester" } };

test("a plugin added by its folder declares its role, model setting and package", async () => {
  const plugins = await pluginsFolder({ roles, settings, packages });
  const catalog = await loadCatalog(await readPluginFolder(plugins));
  expect(catalog.roles.get("tester")).toEqual({
    role: tester,
    setting: { label: "Tester", hint: "Tests the app.", tier: "low" },
  });
  expect(catalog.packages.get("tester")).toEqual({
    path: join(plugins, "tester", "src", "tester.ts"),
    declared: packages.tester,
  });
});

test("a plugin whose role runs on no declared setting, or whose package has no entry or plays a role it does not declare, is refused", async () => {
  const unset = await pluginsFolder({ roles, packages });
  await expect(loadCatalog(await readPluginFolder(unset))).rejects.toThrow(
    "The role tester runs on testing, a model setting no plugin declares",
  );
  const missing = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "./src/missing.ts", role: "tester" } },
  });
  await expect(loadCatalog(await readPluginFolder(missing))).rejects.toThrow(
    "@example/tester's package tester has no entry at ./src/missing.ts",
  );
  const unplayed = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "./src/tester.ts", role: "reviewer" } },
  });
  await expect(loadCatalog(await readPluginFolder(unplayed))).rejects.toThrow(
    "@example/tester's package tester plays the role reviewer, which @example/tester does not declare",
  );
});

test("a package entry outside its plugin's folder is refused", async () => {
  const plugins = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "../../outside.ts", role: "tester" } },
  });
  await expect(loadCatalog(await readPluginFolder(plugins))).rejects.toThrow(
    "@example/tester's package tester has its entry outside the plugin, at ../../outside.ts",
  );
});

test("a role two plugins declare is refused, naming both", async () => {
  const plugins = await pluginsFolder({ roles, settings, packages });
  const [tester] = await readPluginFolder(plugins);
  await expect(
    loadCatalog([
      tester!,
      {
        root: tester!.root,
        manifest: { name: "@example/second", builder: { roles, packages: {} } },
      },
    ]),
  ).rejects.toThrow(
    "@example/second declares the role tester, which @example/tester already declares",
  );
});
