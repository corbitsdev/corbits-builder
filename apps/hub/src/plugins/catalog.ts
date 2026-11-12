import { resolve } from "node:path";
import { type } from "arktype";
import { loadCatalog, type Host } from "@corbits-builder/plugin-host/catalog";
import { readPluginFolder } from "@corbits-builder/plugin-host/folder";
import { unregisteredValue } from "../artifacts/project-values.ts";
import { FACTS } from "./facts.ts";
import { STARTERS } from "./starters.ts";

export { isRoute } from "@corbits-builder/plugin-host/catalog";

// From this file rather than the working directory, so every way of starting the hub finds it.
export const PLUGINS_FOLDER = resolve(import.meta.dir, "../../../../plugins");

// All the plugins need from the hub: the facts it works out, the project values it stores and the
// workflows it starts.
export const HOST: Host = {
  facts: FACTS,
  unknownValue: unregisteredValue,
  starters: STARTERS,
};

// Every plugin in the folder, checked once when the hub loads; a wrong one stops the hub.
export const CATALOG = await loadCatalog(
  await readPluginFolder(PLUGINS_FOLDER),
  HOST,
);
export const PLUGINS = CATALOG.plugins;
export const SCREENS = CATALOG.screens;

// The route a project follows, as the hub stores it: a route plugin's handle, or null for none.
export const ProjectRoute = type({ "+": "reject", route: "string > 0 | null" });
