import type { DBConfig } from "@intx/db";

export type Environment = Record<string, string | undefined>;

export function required(env: Environment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function port(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  return parsed;
}

export function readDatabaseConfig(env: Environment): DBConfig {
  const schema = env["PG_SCHEMA"];
  if (schema !== undefined && schema !== "public") {
    throw new Error(
      "This journaled composition supports the public schema only",
    );
  }
  const connectionURL = env["DATABASE_URL"];
  if (connectionURL) {
    const url = new URL(connectionURL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      throw new Error("DATABASE_URL must be a Postgres connection URL");
    }
    const database = decodeURIComponent(url.pathname.slice(1));
    if (!url.hostname || !url.username || !database)
      throw new Error("DATABASE_URL requires host, user and database");
    const sslMode = url.searchParams.get("sslmode");
    return {
      host: url.hostname,
      port: port(url.port || undefined, 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
      ssl: sslMode !== null ? sslMode !== "disable" : env["DB_SSL"] === "true",
      schema: "public",
    };
  }
  return {
    host: required(env, "DB_HOST"),
    port: port(env["DB_PORT"], 5432),
    user: required(env, "DB_USER"),
    password: required(env, "DB_PASSWORD"),
    database: required(env, "DB_NAME"),
    ssl: env["DB_SSL"] === "true",
    schema: "public",
  };
}

export function readMigrationDatabaseConfig(env: Environment): DBConfig {
  return readDatabaseConfig({
    ...env,
    ...(!env["MIGRATION_DATABASE_URL"]
      ? {}
      : { DATABASE_URL: env["MIGRATION_DATABASE_URL"] }),
  });
}

// Entries are exact addresses or `@domain`; the sign-in hooks hold sessions to
// this list. An allowlist needs a way to prove an address: Google (real or
// locally emulated) or email.
function readAllowedEmails(env: Environment): string[] | undefined {
  const raw = env["AUTH_ALLOWED_EMAILS"];
  if (raw === undefined) return undefined;
  const allowedEmails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length === 0)
    throw new Error("AUTH_ALLOWED_EMAILS lists no address or @domain");
  if (
    env["GOOGLE_CLIENT_ID"] === undefined &&
    env["GOOGLE_EMULATE_URL"] === undefined &&
    !env["SMTP_URL"]?.trim()
  )
    throw new Error(
      "AUTH_ALLOWED_EMAILS requires Google sign-in (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or GOOGLE_EMULATE_URL locally) or email (SMTP_URL)",
    );
  return allowedEmails;
}

// Local development only: a loopback Google OAuth emulator stands in for real
// Google credentials so the sign-in flow is exercisable without them. A
// non-loopback address would turn a dev convenience into a deployment
// identity source nobody vetted, so boot refuses it.
export function readGoogleEmulateBaseUrl(env: Environment): string | undefined {
  const raw = env["GOOGLE_EMULATE_URL"];
  if (raw === undefined || raw.trim() === "") return undefined;
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    url.hostname,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopback ||
    url.username ||
    url.password
  )
    throw new Error(
      "GOOGLE_EMULATE_URL must be a loopback HTTP(S) URL without credentials (development emulation only)",
    );
  return url.origin;
}

function assertBareOrigin(name: string, url: URL): void {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${name} must be an HTTP(S) origin without credentials, path, query or fragment`,
    );
}

export function readBaseURL(env: Environment): string {
  return (
    env["BETTER_AUTH_BASE_URL"] ?? `http://localhost:${port(env["PORT"], 8000)}`
  );
}

// Measured starts take seconds (3.6 s cold on a fresh install, 15 s worst over 115 dev
// starts), so a minute leaves margin and a failed start reaches the person soon. Slow
// machines raise it, but a failed start must still arrive before the web's 5-minute
// request ceiling.
export function readCoordinatorStartTimeoutMs(env: Environment): number {
  const value = positiveInteger(env, "COORDINATOR_START_TIMEOUT_MS", 60_000);
  if (value >= 300_000)
    throw new Error("COORDINATOR_START_TIMEOUT_MS must be under 300000");
  return value;
}

export function positiveInteger(
  env: Environment,
  name: string,
  absent: number,
): number {
  const raw = env[name];
  const value = raw === undefined ? absent : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function readHubEnvironment(env: Environment) {
  const credentialKey = required(env, "CREDENTIAL_ENCRYPTION_KEY");
  const principalKey = required(env, "PRINCIPAL_KEY_ENCRYPTION_KEY");
  for (const [name, key] of [
    ["CREDENTIAL_ENCRYPTION_KEY", credentialKey],
    ["PRINCIPAL_KEY_ENCRYPTION_KEY", principalKey],
  ] as const) {
    if (!/^[a-f\d]{64}$/i.test(key)) {
      throw new Error(`${name} must contain exactly 64 hexadecimal characters`);
    }
  }
  if (credentialKey.toLowerCase() === principalKey.toLowerCase()) {
    throw new Error(
      "Credential and principal encryption keys must be distinct",
    );
  }
  if (required(env, "BETTER_AUTH_SECRET").length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  const authBaseURL = readBaseURL(env);
  const baseURL = new URL(authBaseURL);
  if (
    !["http:", "https:"].includes(baseURL.protocol) ||
    baseURL.username ||
    baseURL.password
  ) {
    throw new Error(
      "BETTER_AUTH_BASE_URL must be an HTTP(S) URL without credentials",
    );
  }
  const hubApiOrigin = new URL(env["HUB_API_ORIGIN"] ?? baseURL.origin);
  if (
    (env["GOOGLE_CLIENT_ID"] === undefined) !==
    (env["GOOGLE_CLIENT_SECRET"] === undefined)
  ) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
    );
  }
  // The origin that serves the human UI. It defaults to the hub's API origin
  // (same-origin serving); a deployment hosting the UI elsewhere must declare
  // it so auth callback URLs are trusted deliberately, never by pattern.
  const uiOrigin = new URL(env["UI_PUBLIC_URL"] ?? baseURL.origin);
  assertBareOrigin("UI_PUBLIC_URL", uiOrigin);
  assertBareOrigin("HUB_API_ORIGIN", hubApiOrigin);
  return {
    database: readDatabaseConfig(env),
    credentialKey,
    principalKey,
    hostname: env["HOST"] ?? "127.0.0.1",
    port: port(env["PORT"], 8000),
    dataDir: env["HUB_DATA_DIR"] ?? "data/hub",
    webDir: env["HUB_WEB_DIR"],
    baseURL: authBaseURL,
    hubApiOrigin: hubApiOrigin.origin,
    uiOrigin: uiOrigin.origin,
    allowedEmails: readAllowedEmails(env),
  };
}
