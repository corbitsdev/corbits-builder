import { isAbsolute } from "node:path";
import type { DBConfig } from "@intx/db";
import { LifecycleDuration, lifecycleDurationMs } from "@intx/types";
import { getLogLevels } from "@logtape/logtape";
import { list, origin, port, reader } from "@corbits-builder/environment";
import { type, type Traversal } from "arktype";
import type { BootstrapOptions } from "./bootstrap.ts";
import { defaultDockerLimits } from "./provisioning/docker.ts";

// Every variable the hub's own code reads, in the hub server, `bun run db:migrate` and
// `bun run auth:bootstrap`. Each of those entry points reads its environment once and passes what
// it gets down. Each rule describes what it expects in words and never puts the refused value in
// its error, because the value can be a secret.

/** A variable that must hold something other than whitespace. */
const filled = type(/\S/).describe("non-blank");

/** Text with surrounding whitespace trimmed; blank text counts as unset. */
const trimmed = type("string").pipe(
  (value): string | undefined => value.trim() || undefined,
);

/** An on/off switch: "true" or "false", with `fallback` when unset or empty. */
const flag = (fallback: boolean) =>
  type("string")
    .pipe((value, ctx) => {
      if (value === "") return fallback;
      if (value === "true" || value === "false") return value === "true";
      return ctx.error("true or false");
    })
    .default("");

/** A whole number above zero, as Number reads it. */
const positiveInteger = type("string").pipe((value, ctx) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : ctx.error("a positive integer");
});

/** A 256-bit key as 64 hexadecimal characters. */
const hexKey = type(/^[a-f\d]{64}$/i).describe("64 hexadecimal characters");

/** `value` as a URL, when it parses with one of `protocols` and has no username or password. */
const parseURL = (value: string, protocols: readonly string[]) => {
  const url = URL.parse(value);
  return url &&
    protocols.includes(url.protocol) &&
    !url.username &&
    !url.password
    ? url
    : undefined;
};

const httpURL = type("string").pipe((value, ctx) =>
  parseURL(value, ["http:", "https:"])
    ? value
    : ctx.error("an HTTP(S) URL without credentials"),
);

// Empty reads as unset, so the DB_* variables apply.
const postgresURL = type("string").pipe((value, ctx) => {
  if (value === "") return undefined;
  const url = URL.parse(value);
  const database = url && decodeURIComponent(url.pathname.slice(1));
  const portNumber = Number(url?.port || 5432);
  if (
    !url ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !database ||
    portNumber < 1
  )
    return ctx.error("a Postgres connection URL with host, user and database");
  return {
    host: url.hostname,
    port: portNumber,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslMode: url.searchParams.get("sslmode"),
  };
});
type DatabaseURL = NonNullable<typeof postgresURL.infer>;

// Local development only: a loopback Google OAuth emulator stands in for real Google credentials,
// so the sign-in flow can be tried without them. Boot refuses a non-loopback address, because it
// would turn a development shortcut into an identity source for a deployment that nobody vetted.
const loopbackOrigin = trimmed.pipe((value, ctx) => {
  if (value === undefined) return undefined;
  const url = parseURL(value, ["http:", "https:"]);
  return url &&
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
    ? url.origin
    : ctx.error(
        "a loopback HTTP(S) URL without credentials (development emulation only)",
      );
});

// A deployment that publishes ports, such as Compose, needs to know the live-app port range in
// advance. Without a range, the live app uses any free port.
const portRange = trimmed.pipe((value, ctx) => {
  if (value === undefined) return undefined;
  const match = /^(\d{1,5})-(\d{1,5})$/.exec(value);
  const from = Number(match?.[1]);
  const to = Number(match?.[2]);
  return match && from >= 1 && to <= 65535 && from <= to
    ? { from, to }
    : ctx.error("a port range such as 4100-4119");
});

const absolutePaths = trimmed.pipe((value, ctx) => {
  const paths = value?.split(":") ?? [];
  return paths.every((path) => isAbsolute(path))
    ? paths
    : ctx.error('absolute paths separated by ":"');
});

const smtpURL = trimmed.pipe((value, ctx) => {
  if (value === undefined) return undefined;
  // A mail URL includes its login, so credentials are allowed here.
  const url = URL.parse(value);
  return url &&
    ["smtp:", "smtps:"].includes(url.protocol) &&
    url.hostname &&
    !/\s/.test(value)
    ? value
    : ctx.error("an smtp:// or smtps:// URL");
});

const oneLine = trimmed.pipe((value, ctx) =>
  value !== undefined && ["\r", "\n", "\0"].some((c) => value.includes(c))
    ? ctx.error("one line")
    : value,
);

const positiveDuration = LifecycleDuration.narrow(
  (value, ctx) => lifecycleDurationMs(value) > 0 || ctx.mustBe("positive"),
);

const databaseVariables = {
  // DATABASE_URL replaces the DB_* variables when set.
  "DATABASE_URL?": postgresURL,
  "DB_HOST?": "string",
  DB_PORT: port.default("5432"),
  "DB_USER?": "string",
  "DB_PASSWORD?": "string",
  "DB_NAME?": "string",
  DB_SSL: flag(false),
  // Migrations and queries name the public schema, so no other is accepted.
  "PG_SCHEMA?": "'public'",
} as const;

const DatabaseVariables = type(databaseVariables);
type DatabaseVariables = typeof DatabaseVariables.infer;

// A broken rule across variables, reported on the variable to change.
const reject = (ctx: Traversal, variable: string, expected: string) =>
  ctx.reject({ path: [variable], expected });

const databaseRules = (
  env: DatabaseVariables,
  connectionURL: DatabaseURL | undefined,
  ctx: Traversal,
) => {
  if (connectionURL) return;
  for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const)
    if (!env[name]?.trim()) reject(ctx, name, "set when DATABASE_URL is not");
};

const databaseConfig = (
  env: DatabaseVariables,
  connectionURL: DatabaseURL | undefined,
): DBConfig =>
  connectionURL
    ? {
        host: connectionURL.host,
        port: connectionURL.port,
        user: connectionURL.user,
        password: connectionURL.password,
        database: connectionURL.database,
        ssl:
          connectionURL.sslMode !== null
            ? connectionURL.sslMode !== "disable"
            : env.DB_SSL,
        schema: "public",
      }
    : {
        host: env.DB_HOST!,
        port: env.DB_PORT,
        user: env.DB_USER!,
        password: env.DB_PASSWORD!,
        database: env.DB_NAME!,
        ssl: env.DB_SSL,
        schema: "public",
      };

// Where the hub keeps agents' saved conversations, which a migration moves too.
const agentStateVariables = {
  HUB_DATA_DIR: "string = 'data/hub'",
  "SIDECAR_IMAGE?": "string",
  SIDECAR_DOCKER_HOST: "string = 'unix:///var/run/docker.sock'",
  "SIDECAR_DOCKER_HUB_ID?": "string",
} as const;

const migrationVariables = {
  // Separate credentials for migrations, such as the schema owner's.
  "MIGRATION_DATABASE_URL?": postgresURL,
  ...agentStateVariables,
} as const;

const MigrationVariables = type({
  ...databaseVariables,
  ...migrationVariables,
});
type MigrationVariables = typeof MigrationVariables.infer;

const migrationURL = (env: MigrationVariables) =>
  env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;

const hubVariables = {
  ...databaseVariables,
  ...agentStateVariables,
  // Surrounding whitespace adds nothing to a secret, so it does not count toward its length.
  BETTER_AUTH_SECRET: type("string").narrow(
    (value, ctx) =>
      value.trim().length >= 32 ||
      ctx.mustBe("at least 32 characters, not counting surrounding whitespace"),
  ),
  CREDENTIAL_ENCRYPTION_KEY: hexKey,
  PRINCIPAL_KEY_ENCRYPTION_KEY: hexKey,
  HOST: "string = '127.0.0.1'",
  PORT: port.default("8000"),
  "HUB_WEB_DIR?": "string",
  // The address people sign in at; http://localhost:$PORT unless set.
  "BETTER_AUTH_BASE_URL?": httpURL,
  "HUB_PUBLIC_URL?": httpURL,
  "HUB_API_ORIGIN?": origin,
  // The origin that serves the human UI, same as the hub's unless set. A deployment hosting the UI
  // elsewhere declares it so auth callback URLs are trusted deliberately, never by pattern.
  "UI_PUBLIC_URL?": origin,
  "LIVE_APP_PORTS?": portRange,
  // Folders beyond the system's own that every build sandbox reads but never writes.
  SANDBOX_TOOLCHAIN_PATHS: absolutePaths.default(""),
  "GOOGLE_CLIENT_ID?": "string",
  "GOOGLE_CLIENT_SECRET?": "string",
  "GOOGLE_EMULATE_URL?": loopbackOrigin,
  // Exact addresses or `@domain`; the sign-in hooks hold sessions to this list.
  "AUTH_ALLOWED_EMAILS?": list.pipe((entries, ctx) =>
    entries.length === 0
      ? ctx.error("at least one address or @domain")
      : entries.map((entry) => entry.toLowerCase()),
  ),
  "SMTP_URL?": smtpURL,
  "EMAIL_FROM?": oneLine,
  // Measured starts take seconds (3.6 s cold on a fresh install, 15 s worst over 115 dev starts),
  // so a minute leaves margin and a failed start reaches the person soon. Slow machines raise it,
  // but a failed start must still arrive before the web's 5-minute request ceiling.
  COORDINATOR_START_TIMEOUT_MS: positiveInteger
    .narrow((value, ctx) => value < 300_000 || ctx.mustBe("under 300000"))
    .default("60000"),
  // Whether, and by which search, the hub notes likely plugins under the person's message to the
  // coordinator.
  PLUGIN_HINT: "'off' | 'triggers' | 'fields' = 'off'",
  // The server's provider keys, shared with every workspace unless SERVER_PROVIDER_KEYS is false.
  SERVER_PROVIDER_KEYS: flag(true),
  "ANTHROPIC_API_KEY?": trimmed,
  "OPENAI_API_KEY?": trimmed,
  "GEMINI_API_KEY?": trimmed,
  "XAI_API_KEY?": trimmed,
  // Providers whose keys the server cannot use; setting one is reported, not used.
  "OPENCODE_API_KEY?": trimmed,
  "ZAI_API_KEY?": trimmed,
  PRODUCT_CONFIGURED_NAMING: flag(false),
  "PRODUCT_NAME?": trimmed,
  "PRODUCT_HELLO_WORDING?": trimmed,
  LOG_LEVEL: type.enumerated(...getLogLevels()).default("info"),
  // Builder reads these to decide whether to export logs and traces. The OpenTelemetry exporters
  // also read them, along with the pass-through variables below.
  "OTEL_EXPORTER_OTLP_ENDPOINT?": "string",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?": "string",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?": "string",
  "OTEL_SERVICE_NAME?": "string",
  OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: flag(false),
  // Interchange parses the manifest; the hub only passes it through.
  "SIDECAR_ADAPTER_MANIFEST?": "string",
  SIDECAR_LOCAL_MAX_ACTIVE: positiveInteger.default("32"),
  // Whether the hub may reach a person's server over SSH at a loopback or private address. The one
  // setting covers both reading its host key and a sidecar running commands on it. Off unless set,
  // because a rented server is never at such an address and Builder's own network is.
  SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES: flag(false),
  "SIDECAR_HUB_WS_URL?": "string",
  SIDECAR_MEMORY_BYTES: positiveInteger.default(
    String(defaultDockerLimits.memoryBytes),
  ),
  SIDECAR_PIDS: positiveInteger.default(String(defaultDockerLimits.pids)),
  SIDECAR_NANO_CPUS: positiveInteger.default(
    String(defaultDockerLimits.nanoCpus),
  ),
  WORKFLOW_DEFAULT_MAX_LIFETIME: positiveDuration.default("7d"),
  WORKFLOW_DEFAULT_MAX_DISCONNECTED: positiveDuration.default("15m"),
  // When a designer's design check does not pass, its drawing exists only in its run's folder,
  // which is deleted when the slot is freed. Keeping a completed run this long leaves the drawing
  // there for the next pass.
  WORKFLOW_DEFAULT_RETENTION_COMPLETED: LifecycleDuration.default("15m"),
  WORKFLOW_DEFAULT_RETENTION_FAILED: LifecycleDuration.default("24h"),
  WORKFLOW_DEFAULT_RETENTION_CANCELLED: LifecycleDuration.default("1h"),
} as const;

const HubVariables = type(hubVariables);
type HubVariables = typeof HubVariables.infer;

// Two variables that work only together: either both are set or neither is.
const together = <env>(
  env: env,
  first: keyof env & string,
  second: keyof env & string,
  ctx: Traversal,
) => {
  if ((env[first] === undefined) === (env[second] === undefined)) return;
  if (env[first] === undefined) reject(ctx, first, `set, since ${second} is`);
  else reject(ctx, second, `set, since ${first} is`);
};

const hubRules = (env: HubVariables, ctx: Traversal) => {
  databaseRules(env, env.DATABASE_URL, ctx);
  if (
    env.CREDENTIAL_ENCRYPTION_KEY.toLowerCase() ===
    env.PRINCIPAL_KEY_ENCRYPTION_KEY.toLowerCase()
  )
    reject(
      ctx,
      "PRINCIPAL_KEY_ENCRYPTION_KEY",
      "different from CREDENTIAL_ENCRYPTION_KEY",
    );
  together(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", ctx);
  // An allowlist needs a way to prove an address: Google (real or locally emulated) or email.
  if (
    env.AUTH_ALLOWED_EMAILS !== undefined &&
    env.GOOGLE_CLIENT_ID === undefined &&
    env.GOOGLE_EMULATE_URL === undefined &&
    env.SMTP_URL === undefined
  )
    reject(
      ctx,
      "AUTH_ALLOWED_EMAILS",
      "set only with Google sign-in (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or GOOGLE_EMULATE_URL locally) or email (SMTP_URL)",
    );
  together(env, "SMTP_URL", "EMAIL_FROM", ctx);
  return !ctx.hasError();
};

const hubSettings = (env: HubVariables) => {
  const baseURL = env.BETTER_AUTH_BASE_URL ?? `http://localhost:${env.PORT}`;
  const baseOrigin = new URL(baseURL).origin;
  return {
    database: databaseConfig(env, env.DATABASE_URL),
    baseURL,
    // The hub address people reach: the base URL, unless HUB_PUBLIC_URL is set for a proxy.
    publicURL: new URL(env.HUB_PUBLIC_URL ?? baseURL),
    // Where sidecars call the hub's API.
    hubApiOrigin: env.HUB_API_ORIGIN ?? baseOrigin,
    uiOrigin: env.UI_PUBLIC_URL ?? baseOrigin,
  };
};

/** The hub server's environment: every variable it reads, and what is built from several. */
const hubSchema = type({ "+": "delete", ...hubVariables })
  .narrow(hubRules)
  .pipe((env) => ({ ...env, ...hubSettings(env) }));
export const readHubEnvironment = reader(hubSchema);
export type HubEnvironment = ReturnType<typeof readHubEnvironment>;
export type PluginHint = HubEnvironment["PLUGIN_HINT"];

/** `bun run db:migrate`'s environment: the database and the agent state it moves, never the hub's secrets. */
const migrationSchema = type({
  "+": "delete",
  ...databaseVariables,
  ...migrationVariables,
})
  .narrow((env, ctx) => {
    databaseRules(env, migrationURL(env), ctx);
    return !ctx.hasError();
  })
  .pipe((env) => ({
    ...env,
    migrationDatabase: databaseConfig(env, migrationURL(env)),
  }));
export const readMigrationEnvironment = reader(migrationSchema);
export type MigrationEnvironment = ReturnType<typeof readMigrationEnvironment>;

const bootstrapVariables = {
  // A dedicated machine account, never a person's browser session.
  BOOTSTRAP_EMAIL: filled,
  BOOTSTRAP_PASSWORD: filled,
  "BOOTSTRAP_NAME?": "string",
  BOOTSTRAP_TENANT_SLUG: filled,
  "BOOTSTRAP_TENANT_NAME?": "string",
} as const;

/**
 * `bun run auth:bootstrap`'s environment: it migrates, starts the hub and signs in its setup
 * account, so it reads all three.
 */
const setupSchema = type({
  "+": "delete",
  ...hubVariables,
  ...migrationVariables,
  ...bootstrapVariables,
})
  .narrow(hubRules)
  .pipe((env) => {
    const settings = hubSettings(env);
    const bootstrap: BootstrapOptions = {
      baseURL: settings.baseURL,
      email: env.BOOTSTRAP_EMAIL,
      password: env.BOOTSTRAP_PASSWORD,
      name: env.BOOTSTRAP_NAME ?? env.BOOTSTRAP_EMAIL,
      tenantSlug: env.BOOTSTRAP_TENANT_SLUG,
      tenantName: env.BOOTSTRAP_TENANT_NAME ?? env.BOOTSTRAP_TENANT_SLUG,
    };
    return {
      ...env,
      ...settings,
      migrationDatabase: databaseConfig(env, migrationURL(env)),
      bootstrap,
    };
  });
export const readSetupEnvironment = reader(setupSchema);
export type SetupEnvironment = ReturnType<typeof readSetupEnvironment>;
