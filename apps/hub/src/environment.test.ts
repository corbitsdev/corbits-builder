import { describe, expect, test } from "bun:test";
import {
  readDatabaseConfig,
  readHubEnvironment,
  readMigrationDatabaseConfig,
} from "./environment.ts";

const environment = {
  DATABASE_URL: "postgres://app:example@localhost:5432/example",
  BETTER_AUTH_BASE_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-only-secret-not-a-real-credential",
  CREDENTIAL_ENCRYPTION_KEY: "01".repeat(32),
  PRINCIPAL_KEY_ENCRYPTION_KEY: "02".repeat(32),
};

describe("hub environment security boundary", () => {
  test("validates independent encryption keys without a noop fallback", () => {
    const config = readHubEnvironment(environment);
    expect(config.port).toBe(8000);
    expect(config.database.database).toBe("example");
    expect(() =>
      readHubEnvironment({
        ...environment,
        CREDENTIAL_ENCRYPTION_KEY: undefined,
      }),
    ).toThrow("CREDENTIAL_ENCRYPTION_KEY");
    expect(() =>
      readHubEnvironment({
        ...environment,
        PRINCIPAL_KEY_ENCRYPTION_KEY: "not hex",
      }),
    ).toThrow("64 hexadecimal");
    expect(() =>
      readHubEnvironment({
        ...environment,
        PRINCIPAL_KEY_ENCRYPTION_KEY: environment.CREDENTIAL_ENCRYPTION_KEY,
      }),
    ).toThrow("distinct");
  });

  test("rejects weak authentication secrets and invalid serve settings", () => {
    expect(() =>
      readHubEnvironment({ ...environment, BETTER_AUTH_SECRET: "short" }),
    ).toThrow("32 characters");
    expect(() => readHubEnvironment({ ...environment, PORT: "0" })).toThrow(
      "Port",
    );
    expect(() =>
      readHubEnvironment({
        ...environment,
        BETTER_AUTH_BASE_URL: "http://user:password@localhost",
      }),
    ).toThrow("without credentials");
  });

  test("parses standard Postgres URLs, preserving escaped credentials", () => {
    const config = readDatabaseConfig({
      DATABASE_URL:
        "postgresql://worker:p%40ss@db:5433/control%2Dplane?sslmode=require",
    });
    expect(config.host).toBe("db");
    expect(config.port).toBe(5433);
    expect(config.user).toBe("worker");
    expect(config.password).toBe("p@ss");
    expect(config.database).toBe("control-plane");
    expect(config.ssl).toBe(true);
    expect(() =>
      readDatabaseConfig({ DATABASE_URL: "http://db/control" }),
    ).toThrow("Postgres");
  });

  test("pins native Hub credentials to an explicit HTTP origin and rejects URL components that would be dropped", () => {
    expect(
      readHubEnvironment({
        ...environment,
        BETTER_AUTH_BASE_URL: "https://login.example/auth",
      }).hubApiOrigin,
    ).toBe("https://login.example");
    expect(
      readHubEnvironment({
        ...environment,
        HUB_API_ORIGIN: "https://sidecar-hub.example:8443",
      }).hubApiOrigin,
    ).toBe("https://sidecar-hub.example:8443");
    for (const value of [
      "ftp://hub.example",
      "https://user:private@hub.example",
      "https://hub.example/path",
      "https://hub.example/?q=private",
      "https://hub.example/#fragment",
    ])
      expect(() =>
        readHubEnvironment({ ...environment, HUB_API_ORIGIN: value }),
      ).toThrow("HUB_API_ORIGIN");
  });

  test("uses a separate migration owner without changing the app connection", () => {
    const env = {
      ...environment,
      MIGRATION_DATABASE_URL: "postgres://owner:example@localhost:5432/example",
    };
    expect(readMigrationDatabaseConfig(env).user).toBe("owner");
    expect(readDatabaseConfig(env).user).toBe("app");
    expect(readMigrationDatabaseConfig(environment).user).toBe("app");
  });

  test("rejects non-public schemas rather than misapplying public-qualified SQL", () => {
    expect(() =>
      readDatabaseConfig({ ...environment, PG_SCHEMA: "test_schema" }),
    ).toThrow("public schema only");
  });

  test("parses the sign-in allowlist and demands a way to prove an address", () => {
    expect(readHubEnvironment(environment).allowedEmails).toBeUndefined();
    expect(
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: " Person@Example.com , @corp.example ",
        SMTP_URL: "smtp://mail.example:25",
      }).allowedEmails,
    ).toEqual(["person@example.com", "@corp.example"]);
    expect(() =>
      readHubEnvironment({ ...environment, AUTH_ALLOWED_EMAILS: " , " }),
    ).toThrow("lists no address");
    expect(() =>
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: "a@b.example",
      }),
    ).toThrow("requires Google sign-in");
    expect(() =>
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: "a@b.example",
        GOOGLE_CLIENT_ID: "id-only",
      }),
    ).toThrow("set together");
  });
});
