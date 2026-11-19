import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { EnvironmentError, type Variable } from "@corbits-builder/environment";

const root = resolve(import.meta.dir, "../..");
// Recognisable, and of a length no rule names.
const probe = "leak-probe-Value-29-chars-xyz";
// The same, for a variable that takes only a 64-character hexadecimal key.
const hexProbe = "5eed".repeat(16);

type Reader = ((raw: Record<string, string>) => unknown) & {
  variables: readonly Variable[];
};

const isReader = (value: unknown): value is Reader =>
  typeof value === "function" &&
  Array.isArray((value as Partial<Reader>).variables);

const readers = async () => {
  const found: [string, Reader][] = [];
  for (const file of new Bun.Glob(
    "{apps,packages,workflows,scripts}/**/environment.ts",
  ).scanSync({ cwd: root }))
    if (!file.includes("node_modules/"))
      for (const [name, value] of Object.entries(
        await import(resolve(root, file)),
      ))
        if (isReader(value)) found.push([`${file} ${name}`, value]);
  return found;
};

const database = {
  DATABASE_URL: "postgres://app:example@localhost:5432/example",
};
const hub = {
  ...database,
  BETTER_AUTH_SECRET: "test-only-secret-not-a-real-credential",
  CREDENTIAL_ENCRYPTION_KEY: "01".repeat(32),
  PRINCIPAL_KEY_ENCRYPTION_KEY: "02".repeat(32),
};

// A valid environment for each reader that needs more than none, so a probe reaches the rules across
// variables and what is derived from them, which run only once each variable is valid on its own.
const valid: Record<string, Record<string, string>> = {
  "apps/hub/src/environment.ts readHubEnvironment": hub,
  "apps/hub/src/environment.ts readMigrationEnvironment": database,
  "apps/hub/src/environment.ts readSetupEnvironment": {
    ...hub,
    BOOTSTRAP_EMAIL: "setup@example.com",
    BOOTSTRAP_PASSWORD: "test-only-password",
    BOOTSTRAP_TENANT_SLUG: "example",
  },
};

// Environments that break each rule across variables a reader checks, with probes in the variables
// the rule involves.
const databaseRules = [
  { DATABASE_URL: "", DB_HOST: probe, DB_PASSWORD: probe, DB_NAME: probe },
];
const hubRules = [
  ...databaseRules,
  {
    CREDENTIAL_ENCRYPTION_KEY: hexProbe,
    PRINCIPAL_KEY_ENCRYPTION_KEY: hexProbe,
  },
  { GOOGLE_CLIENT_ID: probe },
  { GOOGLE_CLIENT_SECRET: probe },
  { AUTH_ALLOWED_EMAILS: probe },
  { EMAIL_FROM: probe },
  { SMTP_URL: `smtp://${probe}@mail.example` },
];
const crossRules: Record<string, readonly Record<string, string>[]> = {
  "apps/hub/src/environment.ts readHubEnvironment": hubRules,
  "apps/hub/src/environment.ts readMigrationEnvironment": databaseRules,
  "apps/hub/src/environment.ts readSetupEnvironment": hubRules,
};

// The message of the error read throws on raw, or undefined when it reads it.
const refusal = (read: Reader, raw: Record<string, string>) => {
  try {
    read(raw);
    return undefined;
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;
    return error.message;
  }
};

const expectNoLeak = (
  where: string,
  message: string,
  values: readonly string[],
) => {
  for (const value of values) {
    expect(`${where}: ${message}`).not.toContain(value);
    expect(`${where}: ${message}`).not.toContain(String(value.length));
  }
};

test("no environment error repeats a value, or its length", async () => {
  const found = await readers();
  const names = found.map(([name]) => name);
  expect(names).toContain("apps/hub/src/environment.ts readHubEnvironment");
  expect(
    [...Object.keys(valid), ...Object.keys(crossRules)].filter(
      (name) => !names.includes(name),
    ),
  ).toEqual([]);

  let refused = 0;
  for (const [name, read] of found) {
    const base = valid[name] ?? {};
    const unread = refusal(read, base);
    if (unread !== undefined)
      throw new Error(
        `${name} refuses its valid environment, so give it one here: ${unread}`,
      );
    for (const { name: variable } of read.variables) {
      const message = refusal(read, { ...base, [variable]: probe });
      if (message === undefined) continue;
      refused += 1;
      expectNoLeak(`${name} ${variable}`, message, [probe]);
    }
    for (const rule of crossRules[name] ?? []) {
      const message = refusal(read, { ...base, ...rule });
      expect(message).toBeString();
      expectNoLeak(
        `${name} ${Object.keys(rule).join(", ")}`,
        message ?? "",
        [probe, hexProbe].filter((value) =>
          Object.values(rule).some((set) => set.includes(value)),
        ),
      );
    }
  }
  expect(refused).toBeGreaterThan(0);
});
