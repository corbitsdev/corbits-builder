import { expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { createHubRuntime } from "@corbits-builder/hub/app";
import { migrateDatabase } from "@corbits-builder/hub/migrate";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required e2e environment: ${name}`);
  return value;
}

const approach = (id: string) => ({
  id,
  name: `Approach ${id}`,
  summary: "A way to build it.",
  bestFor: "Trying it out.",
  pros: ["Quick"],
  cons: ["Limited"],
  effort: "low",
  risks: [],
});

// Agents read a rejection's reasons only as a list of {path, message}, so a rejected document
// write must name the field to change in that form.
test("a rejected document write names the field in its issues", async () => {
  const database = {
    host: required("E2E_DB_HOST"),
    port: Number(required("E2E_DB_PORT")),
    username: required("E2E_DB_USER"),
    password: required("E2E_DB_PASSWORD"),
  };
  const dbName = `sb_write_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres({
    ...database,
    database: "postgres",
    max: 1,
    onnotice: () => undefined,
  });
  await admin.unsafe(`create database ${dbName}`);
  const directory = await mkdtemp(join(tmpdir(), "sb-artifact-write-"));
  const origin = "http://127.0.0.1:1";
  const environment: Record<string, string> = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    // Never bound: requests go straight to the app.
    PORT: "1",
    DB_HOST: database.host,
    DB_PORT: String(database.port),
    DB_USER: database.username,
    DB_PASSWORD: database.password,
    DB_NAME: dbName,
    DB_SSL: "false",
    BETTER_AUTH_BASE_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PRINCIPAL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HUB_DATA_DIR: join(directory, "hub"),
  };
  let runtime: Awaited<ReturnType<typeof createHubRuntime>> | undefined;
  try {
    await migrateDatabase(environment);
    runtime = await createHubRuntime(environment);
    const call = (path: string, body: unknown, cookie?: string) =>
      runtime!.app.fetch(
        new Request(`${origin}${path}`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const signUp = await call("/api/auth/sign-up/email", {
      email: `write-${dbName}@example.invalid`,
      password: randomBytes(16).toString("hex"),
      name: "Artifact write e2e",
    });
    expect(signUp.status).toBe(200);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const created = await call(
      "/api/tenants",
      { name: "Artifact write e2e", slug: dbName.replaceAll("_", "-") },
      cookie,
    );
    expect(created.status).toBe(201);
    const tenantId = ((await created.json()) as { id: string }).id;
    // The write is checked before the project is looked up, so no project (and no coordinator
    // run) is needed for the rejection.
    const write = await call(
      `/api/tenants/${tenantId}/projects/p-${randomUUID().replaceAll("-", "")}/artifacts`,
      {
        kind: "problem_brief",
        title: "Brief",
        content: "# Brief\n\nThe problem.",
        approaches: { approaches: [approach("a"), approach("b")] },
      },
      cookie,
    );
    expect(write.status).toBe(400);
    expect(await write.json()).toEqual({
      code: "invalid_artifact_write",
      issues: [{ path: "approaches", message: expect.any(String) }],
    });
  } finally {
    await runtime?.close();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
