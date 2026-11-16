import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { CATALOG, HOST, PLUGINS_FOLDER } from "./catalog.ts";

const folders = await readPluginFolder(PLUGINS_FOLDER);

// An installed plugin folder with its builder block replaced.
function withBuilder(folder: string, builder: unknown) {
  const found = folders.find((each) => each.folder === folder);
  if (!found) throw new Error(`plugins/${folder} is not installed`);
  return {
    folder,
    manifest: { name: `@corbits-builder/${folder}`, version: "0.1.0", builder },
    has: found.has,
    module: found.module,
    text: found.text,
    files: found.files,
  };
}

// The designer with one screen action, pick-colours, in the given groups and with the given entry.
const colours = (groups: unknown, entry: object) =>
  withBuilder("designer", {
    handle: "designer",
    runs: "specialist",
    groups,
    when: "The person wants other colours.",
    unless: "They want a new look.",
    facts: {
      "filed:design_option": "a design option is filed",
      design_chosen: "the person chose a design from the design options",
    },
    actions: {
      "pick-colours": entry,
    },
  });

test("a plugin whose builder block has no groups stops the hub, naming its folder and the field", async () => {
  const loading = loadCatalog([colours("look", {})], HOST);
  await expect(loading).rejects.toThrow("plugins/designer/package.json");
  await expect(loading).rejects.toThrow("groups");
});

test("an agent tools module without a proper default export stops the hub, naming the plugin and the file", async () => {
  const { builder } = await Bun.file(
    join(PLUGINS_FOLDER, "presenter", "package.json"),
  ).json();
  const found = withBuilder("presenter", builder);
  const module = found.module;
  for (const exported of [undefined, {}]) {
    found.module = async (path) =>
      path === "./src/tools.ts" ? exported : module(path);
    await expect(
      loadCatalog(
        [...folders.filter(({ folder }) => folder !== "presenter"), found],
        HOST,
      ),
    ).rejects.toThrow(
      "presenter's agent presenter tools module ./src/tools.ts has no defineTools factory as its default export",
    );
  }
});

test("an action that still says what kind it is stops the hub, naming the field to remove", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "designer"),
        colours(["look"], { runs: "screen" }),
      ],
      HOST,
    ),
  ).rejects.toThrow("designer pick-colours is a screen");
});

test("a screen that reads a project value the hub does not have stops the hub", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "designer"),
        colours(["look"], {
          reads: ["brand.guidelines", "look.colour-primary"],
        }),
      ],
      HOST,
    ),
  ).rejects.toThrow("look.colour-primary");
});

test("a workflow action that requires a fact Builder cannot work out, or templates a field it does not take, stops the hub", async () => {
  const specialist = (requires: string[][]) =>
    loadCatalog(
      [
        ...folders,
        withBuilder("coder", {
          handle: "polisher",
          runs: "specialist",
          groups: ["build"],
          when: "The person wants the app polished.",
          unless: "They want a change of their own.",
          actions: {
            change: {
              start: {
                workflow: "coder",
                correlation: "polisher",
                app: "existing",
              },
              requires,
              returns: [],
            },
          },
        }),
      ],
      HOST,
    );
  await expect(specialist([["app_polished"]])).rejects.toThrow(
    "polisher change names app_polished",
  );
  await expect(specialist([["filed:{kind}"]])).rejects.toThrow("filed:{kind}");
  expect(
    (await specialist([["app_exists"]])).installed("polisher")?.guidance,
  ).toContain("polisher change");
});

test("a ready-made plan that names an action that is not installed stops the hub", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "build-web-app"),
        withBuilder("build-web-app", {
          handle: "write-a-novel",
          runs: "plan",
          groups: ["writing"],
          when: "The person wants a novel.",
          unless: "They want an app.",
          guidance: "./SKILL.md",
          steps: [{ plugin: "writer", action: "write-chapter", requires: [] }],
          ends: "app_exists",
        }),
      ],
      HOST,
    ),
  ).rejects.toThrow("writer write-chapter");
});

// The ending goes into the designer's report, which the page shows the person as it is.
test("a designer's finished report names its screens in plain words, with no tool call", () => {
  const designer = CATALOG.packages.get("designer");
  if (designer === undefined || !("agent" in designer))
    throw new Error("the designer declares no agent designer");
  const ending = designer.agent.presents;
  expect(ending).toContain("The choose screen, when:");
  expect(ending).toContain("The review screen, when:");
  expect(ending).not.toMatch(/execute|[{}()]/);
});

test("a workflow package whose entry a symlink leads outside its plugin stops the hub, naming the plugin and the entry", async () => {
  // Inside the hub, so the copied plugin still resolves its imports.
  const scratch = join(import.meta.dir, "../../.tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "escaping-entry-"));
  try {
    const plugin = join(root, "plugins", "tester");
    await cp(join(import.meta.dir, "fixtures", "tester"), plugin, {
      recursive: true,
    });
    await writeFile(join(root, "outside.ts"), "export default {};\n");
    await symlink(join(root, "outside.ts"), join(plugin, "src", "escape.ts"));
    const manifest = await Bun.file(join(plugin, "package.json")).json();
    manifest.builder.packages = { probe: { entry: "./src/escape.ts" } };
    await writeFile(join(plugin, "package.json"), JSON.stringify(manifest));
    const loading = loadCatalog(
      [...folders, ...(await readPluginFolder(join(root, "plugins")))],
      HOST,
    );
    await expect(loading).rejects.toThrow(
      "@corbits-builder/tester's workflow package probe has no entry inside plugins/tester at ./src/escape.ts",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a design plugin that declares no starter and no themes loads with an empty theme list", async () => {
  const { builder } = await Bun.file(
    join(PLUGINS_FOLDER, "designer", "package.json"),
  ).json();
  const catalog = await loadCatalog(
    [
      ...folders.filter(({ folder }) => folder !== "designer"),
      withBuilder("designer", {
        ...builder,
        design: {
          looks: [{ id: "plain", label: "Plain", direction: "Plain type." }],
        },
      }),
    ],
    HOST,
  );
  expect(catalog.design?.themes.size).toBe(0);
  expect(catalog.design?.themeOf("Plain")).toBeUndefined();
});

test("the coordinator reads every look the designer declares, by label and direction", () => {
  const mockup = CATALOG.actions.find(({ name }) => name === "designer mockup");
  if (!mockup) throw new Error("designer mockup is not installed");
  expect(CATALOG.design?.looks.length).toBeGreaterThan(0);
  for (const { label, direction } of CATALOG.design?.looks ?? [])
    expect(mockup.guidance).toContain(`- ${label}: ${direction}`);
});

test("a look's label names its theme, and a label that is none of the looks names none", () => {
  expect(CATALOG.design?.themeOf("Workbench")?.id).toBe("workbench");
  expect(CATALOG.design?.themeOf("Quiet ledger")).toBeUndefined();
});
