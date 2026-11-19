import { describe, expect, test } from "bun:test";
import {
  readHubEnvironment,
  readMigrationEnvironment,
  readSetupEnvironment,
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
    expect(config.PORT).toBe(8000);
    expect(config.database.database).toBe("example");
    expect(() =>
      readHubEnvironment({
        ...environment,
        CREDENTIAL_ENCRYPTION_KEY: undefined,
      }),
    ).toThrow(/CREDENTIAL_ENCRYPTION_KEY must be .+ \(missing\)/);
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
    ).toThrow("different from CREDENTIAL_ENCRYPTION_KEY");
  });

  test("rejects weak authentication secrets and invalid serve settings", () => {
    expect(() =>
      readHubEnvironment({ ...environment, BETTER_AUTH_SECRET: "short" }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters");
    expect(() =>
      readHubEnvironment({
        ...environment,
        BETTER_AUTH_SECRET: " ".repeat(40),
      }),
    ).toThrow("BETTER_AUTH_SECRET must be at least 32 characters");
    expect(() => readHubEnvironment({ ...environment, PORT: "0" })).toThrow(
      "PORT",
    );
    expect(() =>
      readHubEnvironment({
        ...environment,
        BETTER_AUTH_BASE_URL: "http://user:password@localhost",
      }),
    ).toThrow("without credentials");
  });

  test("parses standard Postgres URLs, preserving escaped credentials", () => {
    const config = readMigrationEnvironment({
      DATABASE_URL:
        "postgresql://worker:p%40ss@db:5433/control%2Dplane?sslmode=require",
    }).migrationDatabase;
    expect(config.host).toBe("db");
    expect(config.port).toBe(5433);
    expect(config.user).toBe("worker");
    expect(config.password).toBe("p@ss");
    expect(config.database).toBe("control-plane");
    expect(config.ssl).toBe(true);
    expect(() =>
      readMigrationEnvironment({ DATABASE_URL: "http://db/control" }),
    ).toThrow("Postgres");
  });

  test("reads the DB_* variables unless DATABASE_URL replaces them", () => {
    expect(
      readMigrationEnvironment({
        DB_HOST: "db",
        DB_USER: "app",
        DB_PASSWORD: "example",
        DB_NAME: "builder",
      }).migrationDatabase,
    ).toEqual({
      host: "db",
      port: 5432,
      user: "app",
      password: "example",
      database: "builder",
      ssl: false,
      schema: "public",
    });
    for (const unset of ["DB_USER", "DB_PASSWORD", "DB_NAME"])
      expect(() =>
        readMigrationEnvironment({ DB_HOST: "db", DB_PASSWORD: " " }),
      ).toThrow(unset);
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
    expect(readMigrationEnvironment(env).migrationDatabase.user).toBe("owner");
    expect(readHubEnvironment(env).database.user).toBe("app");
    expect(readMigrationEnvironment(environment).migrationDatabase.user).toBe(
      "app",
    );
  });

  test("rejects non-public schemas rather than misapplying public-qualified SQL", () => {
    expect(() =>
      readMigrationEnvironment({ ...environment, PG_SCHEMA: "test_schema" }),
    ).toThrow("PG_SCHEMA");
  });

  test("parses the sign-in allowlist and demands a way to prove an address", () => {
    expect(readHubEnvironment(environment).AUTH_ALLOWED_EMAILS).toBeUndefined();
    expect(
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: " Person@Example.com , @corp.example ",
        SMTP_URL: "smtp://mail.example:25",
        EMAIL_FROM: "Builder <builder@example.com>",
      }).AUTH_ALLOWED_EMAILS,
    ).toEqual(["person@example.com", "@corp.example"]);
    expect(() =>
      readHubEnvironment({ ...environment, AUTH_ALLOWED_EMAILS: " , " }),
    ).toThrow("at least one address or @domain");
    expect(() =>
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: "a@b.example",
      }),
    ).toThrow("set only with Google sign-in");
    expect(() =>
      readHubEnvironment({
        ...environment,
        AUTH_ALLOWED_EMAILS: "a@b.example",
        GOOGLE_CLIENT_ID: "id-only",
      }),
    ).toThrow("GOOGLE_CLIENT_SECRET must be set, since GOOGLE_CLIENT_ID is");
  });

  test("reads email delivery only as a pair of a mail URL and one sender line", () => {
    expect(
      readHubEnvironment({ ...environment, SMTP_URL: " ", EMAIL_FROM: "" })
        .SMTP_URL,
    ).toBeUndefined();
    for (const [variable, mail] of [
      ["EMAIL_FROM", { SMTP_URL: "smtp://mail.example" }],
      ["SMTP_URL", { SMTP_URL: "https://mail.example", EMAIL_FROM: "a@b" }],
      ["EMAIL_FROM", { SMTP_URL: "smtp://mail.example", EMAIL_FROM: "a\nb" }],
    ] as const)
      expect(() => readHubEnvironment({ ...environment, ...mail })).toThrow(
        variable,
      );
  });
});

describe("live-app port range", () => {
  test("reads a range, takes any port without one, and refuses a malformed one", () => {
    const ports = (LIVE_APP_PORTS?: string) =>
      readHubEnvironment({ ...environment, LIVE_APP_PORTS }).LIVE_APP_PORTS;
    expect(ports("4100-4119")).toEqual({ from: 4100, to: 4119 });
    expect(ports()).toBeUndefined();
    expect(ports("")).toBeUndefined();
    for (const raw of ["4100", "4119-4100", "0-10", "4100-70000", "a-b"])
      expect(() => ports(raw)).toThrow("LIVE_APP_PORTS");
  });
});

describe("sandbox toolchain folders", () => {
  test("reads absolute folders, none unless set", () => {
    const paths = (SANDBOX_TOOLCHAIN_PATHS?: string) =>
      readHubEnvironment({ ...environment, SANDBOX_TOOLCHAIN_PATHS })
        .SANDBOX_TOOLCHAIN_PATHS;
    expect(paths()).toEqual([]);
    expect(paths("/opt/homebrew:/Applications/Xcode.app")).toEqual([
      "/opt/homebrew",
      "/Applications/Xcode.app",
    ]);
    expect(() => paths("opt/homebrew")).toThrow("SANDBOX_TOOLCHAIN_PATHS");
  });
});

describe("ssh to private addresses", () => {
  test("is off unless set to true, blank as unset, and anything else stops startup", () => {
    const allowed = (SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES?: string) =>
      readHubEnvironment({
        ...environment,
        SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES,
      }).SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES;
    expect(allowed()).toBe(false);
    expect(allowed("")).toBe(false);
    expect(allowed("false")).toBe(false);
    expect(allowed("true")).toBe(true);
    expect(() => allowed("yes")).toThrow("SIDECAR_SSH_ALLOW_PRIVATE_ADDRESSES");
  });
});

describe("setup", () => {
  test("names the bootstrap account and the hub it signs in to", () => {
    expect(
      readSetupEnvironment({
        ...environment,
        BOOTSTRAP_EMAIL: "setup@example.com",
        BOOTSTRAP_PASSWORD: "example-password",
        BOOTSTRAP_TENANT_SLUG: "kickoff",
      }).bootstrap,
    ).toEqual({
      baseURL: "http://localhost:3000",
      email: "setup@example.com",
      password: "example-password",
      name: "setup@example.com",
      tenantSlug: "kickoff",
      tenantName: "kickoff",
    });
    expect(() => readSetupEnvironment(environment)).toThrow(
      "BOOTSTRAP_EMAIL must be a string (missing)",
    );
  });
});
