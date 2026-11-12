import { expect, test } from "bun:test";
import { loadCatalog } from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { fields } from "@corbits-builder/plugin-host/search/fields";
import { triggers } from "@corbits-builder/plugin-host/search/triggers";
import { HOST, PLUGINS, PLUGINS_FOLDER } from "./catalog.ts";

const handles = (ranked: { handle: string }[]) =>
  ranked.map(({ handle }) => handle);

const folders = await readPluginFolder(PLUGINS_FOLDER);

// An installed plugin folder with its builder block replaced.
function withBuilder(folder: string, builder: unknown) {
  const found = folders.find((each) => each.folder === folder);
  if (!found) throw new Error(`plugins/${folder} is not installed`);
  return {
    folder,
    manifest: { name: `@corbits-builder/${folder}`, builder },
    module: found.module,
    text: found.text,
    files: found.files,
  };
}

// The designer with one screen action, pick-colours, in the given groups and reading the given values.
const colours = (groups: unknown, reads: string[]) =>
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
      "pick-colours": {
        runs: "screen",
        when: "The person wants other colours.",
        unless: "They want a new look.",
        screen: "./src/pick-colours/screen.ts",
        view: "./src/pick-colours/view.tsx",
        reads,
      },
    },
  });

test("a plugin whose builder block has no groups stops the hub, naming its folder and the field", async () => {
  const loading = loadCatalog([colours("look", [])], HOST);
  await expect(loading).rejects.toThrow("plugins/designer/package.json");
  await expect(loading).rejects.toThrow("groups");
});

test("a screen that reads a project value the hub does not have stops the hub", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "designer"),
        colours(["look"], ["look.font-primary", "look.colour-primary"]),
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
            polish: {
              runs: "workflow",
              when: "The person wants the app polished.",
              unless: "They want a change of their own.",
              input: "./src/change.ts",
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
    "polisher polish names app_polished",
  );
  await expect(specialist([["filed:{kind}"]])).rejects.toThrow("filed:{kind}");
  expect(
    (await specialist([["app_exists"]])).installed("polisher")?.guidance,
  ).toContain("polisher polish");
});

test("a route that names an action that is not installed stops the hub", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "build-web-app"),
        withBuilder("build-web-app", {
          handle: "write-a-novel",
          runs: "route",
          groups: ["writing"],
          when: "The person wants a novel.",
          unless: "They want an app.",
          guidance: "./SKILL.md",
          steps: [{ plugin: "writer", action: "write-chapter", requires: [] }],
          outcome: "app_exists",
        }),
      ],
      HOST,
    ),
  ).rejects.toThrow("writer write-chapter");
});

test("fields finds the designer first from how a person complains about type", () => {
  expect(handles(fields("the font is ugly", PLUGINS))[0]).toBe("designer");
  expect(handles(fields("can we use a different typeface", PLUGINS))[0]).toBe(
    "designer",
  );
});

test("triggers matches font as a whole word, not inside confront", () => {
  expect(handles(triggers("change the font", PLUGINS))).toEqual(["designer"]);
  expect(triggers("I want to confront the problem", PLUGINS)).toEqual([]);
});
