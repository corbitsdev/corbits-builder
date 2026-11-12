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
    manifest: { builder },
    module: found.module,
    text: found.text,
  };
}

test("a plugin whose builder block has no groups stops the hub, naming its folder and the field", async () => {
  const loading = loadCatalog(
    [
      withBuilder("pick-colours", {
        handle: "pick-colors",
        runs: "screen",
        screen: "./src/screen.ts",
        view: "./src/view.tsx",
        groups: "look",
        when: "The person wants other colours.",
        unless: "They want a new look.",
      }),
    ],
    HOST,
  );
  await expect(loading).rejects.toThrow("plugins/pick-colours/package.json");
  await expect(loading).rejects.toThrow("groups");
});

test("a plugin that reads a project value the hub does not have stops the hub", async () => {
  await expect(
    loadCatalog(
      [
        ...folders.filter(({ folder }) => folder !== "pick-colours"),
        withBuilder("pick-colours", {
          handle: "pick-colors",
          runs: "screen",
          screen: "./src/screen.ts",
          view: "./src/view.tsx",
          groups: ["look"],
          when: "The person wants other colours.",
          unless: "They want a new look.",
          reads: ["look.font-primary", "look.colour-primary"],
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

test("fields finds pick-fonts first from how a person complains about type", () => {
  expect(handles(fields("the font is ugly", PLUGINS))[0]).toBe("pick-fonts");
  expect(handles(fields("can we use a different typeface", PLUGINS))[0]).toBe(
    "pick-fonts",
  );
});

test("triggers matches font as a whole word, not inside confront", () => {
  expect(handles(triggers("change the font", PLUGINS))).toEqual(["pick-fonts"]);
  expect(triggers("I want to confront the problem", PLUGINS)).toEqual([]);
});
