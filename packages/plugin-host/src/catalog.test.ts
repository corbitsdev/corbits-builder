import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  ended: { failed: "Stopped.", cancelled: "Cancelled.", task: "The tester" },
};
const roles = [tester];
const settings = {
  testing: { label: "Tester", hint: "Tests the app.", tier: "low" },
};
const packages = { tester: { entry: "./src/tester.ts", role: "tester" } };

test("a plugin added by its folder declares its role, model setting and package", async () => {
  const plugins = await pluginsFolder({ roles, settings, packages });
  const catalog = await loadCatalog(await readPluginFolder(plugins), new Set());
  expect(catalog.role("tester")).toEqual(tester);
  expect(catalog.settings.get("testing")).toEqual({
    label: "Tester",
    hint: "Tests the app.",
    tier: "low",
  });
  expect(catalog.packages.get("tester")).toEqual({
    role: "tester",
    entry: await realpath(join(plugins, "tester", "src", "tester.ts")),
  });
});

test("a plugin whose role runs on no declared setting, or whose package has no entry or plays a role it does not declare, is refused", async () => {
  const unset = await pluginsFolder({ roles, packages });
  await expect(
    loadCatalog(await readPluginFolder(unset), new Set()),
  ).rejects.toThrow(
    "The role tester runs on testing, a model setting no plugin declares",
  );
  const missing = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "./src/missing.ts", role: "tester" } },
  });
  await expect(
    loadCatalog(await readPluginFolder(missing), new Set()),
  ).rejects.toThrow(
    "@example/tester's package tester has no entry at ./src/missing.ts",
  );
  const unplayed = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "./src/tester.ts", role: "reviewer" } },
  });
  await expect(
    loadCatalog(await readPluginFolder(unplayed), new Set()),
  ).rejects.toThrow(
    "@example/tester's package tester plays the role reviewer, which @example/tester does not declare",
  );
});

test("a package entry outside its plugin's folder is refused", async () => {
  const plugins = await pluginsFolder({
    roles,
    settings,
    packages: { tester: { entry: "../outside.ts", role: "tester" } },
  });
  await writeFile(join(plugins, "outside.ts"), "");
  await expect(
    loadCatalog(await readPluginFolder(plugins), new Set()),
  ).rejects.toThrow(
    "@example/tester's package tester has its entry outside the plugin, at ../outside.ts",
  );
});

test("a role two plugins declare is refused, naming both", async () => {
  const plugins = await pluginsFolder({ roles, settings, packages });
  const [tester] = await readPluginFolder(plugins);
  await expect(
    loadCatalog(
      [
        tester!,
        {
          root: tester!.root,
          manifest: {
            name: "@example/second",
            builder: { roles, packages: {} },
          },
        },
      ],
      new Set(),
    ),
  ).rejects.toThrow(
    "@example/second declares the role tester, which @example/tester already declares",
  );
});

test("every non-coordinator role needs ended wording at catalog load", async () => {
  const plugins = await pluginsFolder({
    roles: [
      {
        name: "tester",
        model: "testing",
        limits: "document",
        called: "tester",
      },
    ],
    settings,
    packages,
  });
  await expect(
    loadCatalog(await readPluginFolder(plugins), new Set()),
  ).rejects.toThrow("@example/tester's role tester needs ended wording");
});
test("a symlink cannot take a package entry outside its plugin", async () => {
  const plugins = await pluginsFolder({ roles, settings, packages });
  await writeFile(join(plugins, "outside.ts"), "");
  await rm(join(plugins, "tester/src/tester.ts"));
  await symlink(
    join(plugins, "outside.ts"),
    join(plugins, "tester/src/tester.ts"),
  );
  await expect(
    loadCatalog(await readPluginFolder(plugins), new Set()),
  ).rejects.toThrow("outside the plugin");
});
test("substitutions require a unique same-role target and a boolean preference", async () => {
  for (const [extra, when, reason] of [
    [
      {
        second: {
          entry: "./src/tester.ts",
          role: "tester",
          replaces: { package: "tester", when: "enabled" },
        },
      },
      "enabled",
      "already replaces tester",
    ],
    [
      { other: { entry: "./src/tester.ts", role: "other" } },
      "enabled",
      "same role",
    ],
    [{}, "questions", "yes/no preference"],
  ] as const) {
    const declarations: Record<string, unknown> = {
      tester: packages.tester,
      replacement: {
        entry: "./src/tester.ts",
        role: "tester",
        replaces: { package: "other" in extra ? "other" : "tester", when },
      },
    };
    Object.assign(declarations, extra);
    const plugins = await pluginsFolder({
      roles: [
        tester,
        {
          name: "other",
          model: "testing",
          limits: "document",
          called: "other",
          ended: tester.ended,
        },
      ],
      settings,
      packages: declarations,
    });
    await expect(
      loadCatalog(await readPluginFolder(plugins), new Set(["enabled"])),
    ).rejects.toThrow(reason);
  }
});
