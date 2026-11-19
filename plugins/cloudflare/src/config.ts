import { type } from "arktype";
import { AppBuildPath } from "@corbits-builder/schemas/app-files";

// The Workers config file at the app's root, as the workers-skills pack writes it.
export const CONFIG_FILE = "wrangler.jsonc";

// What a publish reads from wrangler.jsonc: the worker's name and built module, its compatibility
// settings, the built client Cloudflare serves, at most one D1 database with its migrations folder,
// and its plain vars. Paths are relative to the app's root.
export type WorkersConfig = {
  name: string;
  main: string;
  compatibilityDate: string;
  compatibilityFlags: readonly string[];
  assets?: {
    directory: string;
    binding?: string;
    config: {
      not_found_handling?: string;
      html_handling?: string;
      run_worker_first?: boolean | readonly string[];
    };
  };
  database?: {
    binding: string;
    name?: string;
    migrations: string;
    // The table that records applied migrations, named as Cloudflare's own tools name it.
    table: string;
  };
  vars: Readonly<Record<string, string>>;
};

export type ConfigReading =
  | { ok: true; config: WorkersConfig }
  | { ok: false; problems: readonly string[] };

// Parses JSON with comments and trailing commas, as wrangler.jsonc is written, leaving text inside
// strings as it is. Returns undefined when the text does not parse.
export function parseJsonc(text: string): unknown {
  let plain = "";
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"') {
      let end = at + 1;
      while (end < text.length && text[end] !== '"')
        end += text[end] === "\\" ? 2 : 1;
      plain += text.slice(at, end + 1);
      at = end;
    } else if (char === "/" && text[at + 1] === "/") {
      while (at < text.length && text[at] !== "\n") at++;
      plain += "\n";
    } else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) return undefined;
      plain += " ";
      at = end + 1;
    } else plain += char;
  }
  // Drop trailing commas: a comma outside a string followed only by whitespace and a closing
  // bracket.
  let json = "";
  for (let at = 0; at < plain.length; at++) {
    const char = plain[at];
    if (char === '"') {
      let end = at + 1;
      while (end < plain.length && plain[end] !== '"')
        end += plain[end] === "\\" ? 2 : 1;
      json += plain.slice(at, end + 1);
      at = end;
    } else if (char === ",") {
      let next = at + 1;
      while (next < plain.length && /\s/.test(plain[next] ?? "")) next++;
      if (plain[next] !== "}" && plain[next] !== "]") json += char;
    } else json += char;
  }
  try {
    return JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

// A worker's name is the first label of its workers.dev address.
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FLAG = /^[a-z0-9_]{1,64}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DATABASE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ROUTE_PATTERN = /^!?\/[!-~]{0,255}$/;
// A path the publish builds and reads. Only short, plain segments are allowed, so a path the app
// writes cannot pass as instructions to whoever reads the check's problems.
const PLAIN_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_PATH = 128;
const NOT_FOUND = ["none", "404-page", "single-page-application"];
const HTML = [
  "auto-trailing-slash",
  "force-trailing-slash",
  "drop-trailing-slash",
  "none",
];
// Fields Cloudflare's own tools accept that Builder does not set up. A problem may name these,
// because the names come from this file and not from the app.
const KNOWN_UNPUBLISHED = new Set([
  "account_id",
  "ai",
  "analytics_engine_datasets",
  "browser",
  "build",
  "containers",
  "dispatch_namespaces",
  "durable_objects",
  "env",
  "hyperdrive",
  "kv_namespaces",
  "limits",
  "migrations",
  "mtls_certificates",
  "placement",
  "queues",
  "r2_buckets",
  "route",
  "routes",
  "rules",
  "secrets_store_secrets",
  "send_email",
  "services",
  "site",
  "tail_consumers",
  "triggers",
  "unsafe",
  "vectorize",
  "version_metadata",
  "workflows",
]);
// The fields a publish reads, plus those it can ignore because they change nothing it does. Any
// other field asks Cloudflare for something Builder does not set up, such as another kind of
// storage or a route on a domain, so the app would not run as its config says.
const TOP = new Set([
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
  "assets",
  "d1_databases",
  "vars",
  "observability",
  "upload_source_maps",
]);
const ASSET_FIELDS = new Set([
  "directory",
  "binding",
  "not_found_handling",
  "html_handling",
  "run_worker_first",
]);
const DATABASE_FIELDS = new Set([
  "binding",
  "database_name",
  "database_id",
  "migrations_dir",
  "migrations_table",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= MAX_PATH &&
  PLAIN_PATH.test(value) &&
  !(AppBuildPath(value) instanceof type.errors);
// Whether one path is the other or lies inside it.
const overlaps = (one: string, other: string) =>
  one === other || one.startsWith(`${other}/`) || other.startsWith(`${one}/`);

type Problems = string[];

function readAssets(
  given: unknown,
  problems: Problems,
): WorkersConfig["assets"] {
  if (given === undefined) return undefined;
  if (!isRecord(given) || !isPath(given["directory"])) {
    problems.push(
      "assets.directory does not name the built client's folder in letters, digits, dots, dashes, underscores and slashes",
    );
    return undefined;
  }
  if (Object.keys(given).some((key) => !ASSET_FIELDS.has(key)))
    problems.push("assets sets a field Builder does not publish");
  const { binding, not_found_handling, html_handling, run_worker_first } =
    given;
  if (
    binding !== undefined &&
    (typeof binding !== "string" || !IDENTIFIER.test(binding))
  )
    problems.push("assets.binding is not a name such as ASSETS");
  if (
    not_found_handling !== undefined &&
    !NOT_FOUND.includes(String(not_found_handling))
  )
    problems.push("assets.not_found_handling is not one Cloudflare takes");
  if (html_handling !== undefined && !HTML.includes(String(html_handling)))
    problems.push("assets.html_handling is not one Cloudflare takes");
  const routes =
    Array.isArray(run_worker_first) &&
    run_worker_first.every(
      (route) => typeof route === "string" && ROUTE_PATTERN.test(route),
    );
  if (
    run_worker_first !== undefined &&
    typeof run_worker_first !== "boolean" &&
    !routes
  )
    problems.push(
      "assets.run_worker_first is not true, false or a list of paths such as /api/*",
    );
  const config: NonNullable<WorkersConfig["assets"]>["config"] = {};
  if (typeof not_found_handling === "string")
    config.not_found_handling = not_found_handling;
  if (typeof html_handling === "string") config.html_handling = html_handling;
  if (typeof run_worker_first === "boolean" || routes)
    config.run_worker_first = run_worker_first as boolean | string[];
  return {
    directory: given["directory"],
    ...(typeof binding === "string" ? { binding } : {}),
    config,
  };
}

function readDatabase(
  databases: unknown,
  problems: Problems,
): WorkersConfig["database"] {
  if (!Array.isArray(databases)) {
    problems.push("d1_databases is not a list");
    return undefined;
  }
  if (databases.length > 1) {
    problems.push("d1_databases binds more than one database");
    return undefined;
  }
  const [given] = databases;
  if (given === undefined) return undefined;
  if (!isRecord(given) || typeof given["binding"] !== "string") {
    problems.push("d1_databases[0] has no binding such as DB");
    return undefined;
  }
  const {
    binding,
    database_name,
    migrations_dir = "migrations",
    migrations_table = "d1_migrations",
  } = given;
  const found = problems.length;
  if (Object.keys(given).some((key) => !DATABASE_FIELDS.has(key)))
    problems.push("d1_databases[0] sets a field Builder does not publish");
  if (!IDENTIFIER.test(binding))
    problems.push("d1_databases[0].binding is not a name such as DB");
  if (
    database_name !== undefined &&
    (typeof database_name !== "string" || !DATABASE_NAME.test(database_name))
  )
    problems.push(
      "d1_databases[0].database_name is not letters, digits, dashes and underscores",
    );
  if (!isPath(migrations_dir))
    problems.push(
      "d1_databases[0].migrations_dir does not name a folder inside the app in letters, digits, dots, dashes, underscores and slashes",
    );
  if (
    typeof migrations_table !== "string" ||
    !IDENTIFIER.test(migrations_table)
  )
    problems.push("d1_databases[0].migrations_table is not a table name");
  if (problems.length > found) return undefined;
  return {
    binding,
    ...(typeof database_name === "string" ? { name: database_name } : {}),
    migrations: String(migrations_dir),
    table: String(migrations_table),
  };
}

function readVars(given: unknown, problems: Problems) {
  const vars: Record<string, string> = {};
  if (!isRecord(given)) {
    problems.push("vars is not an object of settings");
    return vars;
  }
  for (const [key, value] of Object.entries(given)) {
    if (!IDENTIFIER.test(key)) problems.push("vars has a name that is not one");
    else if (typeof value !== "string")
      problems.push("vars has a setting that is not text");
    else vars[key] = value;
  }
  return vars;
}

/**
 * Reads the app's wrangler.jsonc for a publish. Otherwise returns each way it differs from what the
 * workers-skills pack has the app builder write, as plain lines that name only the file's fields.
 */
export function readWorkersConfig(text: string | undefined): ConfigReading {
  if (text === undefined)
    return { ok: false, problems: [`the app has no ${CONFIG_FILE}`] };
  const parsed = parseJsonc(text);
  if (!isRecord(parsed))
    return {
      ok: false,
      problems: [`${CONFIG_FILE} is not a JSON object with comments`],
    };
  const problems: Problems = [];
  for (const key of Object.keys(parsed))
    if (!TOP.has(key))
      problems.push(
        KNOWN_UNPUBLISHED.has(key)
          ? `${CONFIG_FILE} sets ${key}, which Builder does not publish`
          : `${CONFIG_FILE} sets a field Builder does not publish`,
      );
  const { name, main, compatibility_date, compatibility_flags } = parsed;
  if (typeof name !== "string" || !NAME.test(name))
    problems.push(
      "name is not lowercase letters, digits and dashes of at most 63 characters",
    );
  if (!isPath(main) || !/\.m?js$/.test(main))
    problems.push(
      "main does not name the built worker module (a .js file inside the app, named in letters, digits, dots, dashes, underscores and slashes)",
    );
  if (typeof compatibility_date !== "string" || !DATE.test(compatibility_date))
    problems.push("compatibility_date is not a date such as 2026-11-01");
  const flags = compatibility_flags ?? [];
  if (
    !Array.isArray(flags) ||
    !flags.every((flag) => typeof flag === "string" && FLAG.test(flag))
  )
    problems.push("compatibility_flags is not a list of flag names");
  // Without nodejs_compat the worker has no process.env, where the app reads its settings and
  // NODE_ENV, and none of the Node modules the build leaves for the runtime to provide.
  else if (!flags.includes("nodejs_compat"))
    problems.push("compatibility_flags does not hold nodejs_compat");
  const assets = readAssets(parsed["assets"], problems);
  const database = readDatabase(parsed["d1_databases"] ?? [], problems);
  const vars = readVars(parsed["vars"] ?? {}, problems);

  const bindings = [
    ...Object.keys(vars).filter((key) => key !== "NODE_ENV"),
    ...(database ? [database.binding] : []),
    ...(assets?.binding ? [assets.binding] : []),
  ];
  if (new Set(bindings).size !== bindings.length)
    problems.push(`two names the worker reads in ${CONFIG_FILE} are the same`);
  // Cloudflare serves everything in the assets folder publicly, so the worker's code and its
  // migrations must be outside it.

  if (assets !== undefined && isPath(main) && overlaps(main, assets.directory))
    problems.push("main lies inside assets.directory, which anyone can read");
  if (
    assets !== undefined &&
    database !== undefined &&
    overlaps(database.migrations, assets.directory)
  )
    problems.push(
      "d1_databases[0].migrations_dir lies inside assets.directory, which anyone can read",
    );

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      name: name as string,
      main: main as string,
      compatibilityDate: compatibility_date as string,
      compatibilityFlags: flags as string[],
      ...(assets ? { assets } : {}),
      ...(database ? { database } : {}),
      vars,
    },
  };
}
