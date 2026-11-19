import { type } from "arktype";
import { declaredProduction } from "@corbits-builder/plugin";
import type { RunHub } from "@corbits-builder/plugin/run-hub";
import { failed } from "@corbits-builder/plugin/tools";
import type { AppBuildRefusal } from "@corbits-builder/schemas/app-files";
import type { AssetFile } from "./api.ts";
import type { Code, Outcome } from "./codes.ts";
import {
  CONFIG_FILE,
  readWorkersConfig,
  type WorkersConfig,
} from "./config.ts";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  txt: "text/plain",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  webmanifest: "application/manifest+json",
  wasm: "application/wasm",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
};

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
};

const contentType = (path: string) =>
  CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";

const inside = (folder: string, path: string) => path.startsWith(`${folder}/`);

// A migration file's name, as the workers-skills pack has the app builder write it: letters, digits,
// dashes, underscores and dots, ending in .sql. Only such a name goes into the SQL that records it.
const MIGRATION = /^[A-Za-z0-9_.-]{1,128}\.sql$/;

export type Migration = { name: string; sql: string };

/** The saved app as a publish to Workers reads it. */
export type SavedApp = {
  version: string;
  config: WorkersConfig;
  // The database's migration files, in the order they apply.
  migrations: readonly Migration[];
};

/** The project's saved app, its configuration and its migrations, or why it cannot be published. */
export async function savedApp(
  hub: RunHub,
  values: Readonly<Record<string, unknown>>,
): Promise<SavedApp | Outcome> {
  const production = declaredProduction(values);
  if (production === undefined || production instanceof type.errors)
    return failed("not_publishable");
  const source = await hub.source();
  if (source === undefined) return failed("app_not_saved");
  const { files } = source;
  const configText = files.get(CONFIG_FILE);
  const reading = readWorkersConfig(
    configText === undefined ? undefined : new TextDecoder().decode(configText),
  );
  if (!reading.ok) return failed("not_fitted");
  const { config } = reading;
  const migrations: Migration[] = [];
  if (config.database)
    for (const [path, bytes] of files) {
      if (!inside(config.database.migrations, path)) continue;
      const name = path.slice(config.database.migrations.length + 1);
      if (name.includes("/") || !name.endsWith(".sql")) continue;
      // The ready check cannot list a folder, so it cannot catch a misnamed migration. That gets
      // its own code instead of not_fitted.
      if (!MIGRATION.test(name)) return failed("migration_misnamed");
      migrations.push({ name, sql: new TextDecoder().decode(bytes) });
    }
  migrations.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: source.version, config, migrations };
}

const BUILD_CODES: Readonly<
  Record<AppBuildRefusal, [Code, Record<string, string>?]>
> = {
  app_not_filed: ["app_not_saved"],
  stack_production_missing: ["not_publishable"],
  invalid_stack_production: ["not_publishable"],
  app_command_running: ["builder_busy"],
  install_failed: ["install_failed"],
  build_failed: ["build_failed"],
  build_timed_out: ["build_timed_out"],
  build_path_missing: ["not_fitted"],
  build_path_is_link: ["not_fitted"],
  build_output_too_large: ["too_large", { limit: "build_size" }],
};

/** What the app's build made: the worker's module and the client's files as Cloudflare serves them. */
export type BuiltApp = { worker: Uint8Array; assets: readonly AssetFile[] };

export async function builtApp(
  hub: RunHub,
  { version, config }: SavedApp,
): Promise<BuiltApp | Outcome> {
  const built = await hub.build([
    config.main,
    ...(config.assets ? [config.assets.directory] : []),
  ]);
  if ("refused" in built) {
    const [code, fields] = BUILD_CODES[built.refused];
    return failed(code, fields);
  }
  // The app was saved again between the two downloads, so what was built is not what was read.
  if (built.version !== version) return failed("app_changed");
  const { files } = built;
  const worker = files.get(config.main);
  if (worker === undefined) return failed("not_fitted");
  const assets: AssetFile[] = [];
  const directory = config.assets?.directory;
  if (directory !== undefined)
    for (const [path, bytes] of files)
      // A source map would expose the app's source code to anyone who requests it.

      if (inside(directory, path) && extensionOf(path) !== "map") {
        const served = path.slice(directory.length);
        assets.push({ path: served, bytes, contentType: contentType(served) });
      }
  return { worker, assets };
}
