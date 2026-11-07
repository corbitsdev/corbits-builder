import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("a failed migration prints its error code and never the database URL", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--conditions=intx-src",
      fileURLToPath(new URL("./migrate.ts", import.meta.url)),
    ],
    {
      // Nothing listens on port 1, so the connection is refused.
      env: {
        PATH: process.env["PATH"],
        DATABASE_URL: "postgres://builder:db-password@127.0.0.1:1/builder",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode).toBe(1);
  expect(JSON.parse(stderr)).toEqual({
    migrationsApplied: false,
    errorCode: "ECONNREFUSED",
  });
  expect(stdout + stderr).not.toContain("db-password");
});
