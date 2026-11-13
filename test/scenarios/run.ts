/**
 * Runs every scenario one at a time, each in its own output folder under a new temporary folder,
 * and prints one line per scenario: whether it passed and how long it took. The weather projects
 * a scenario starts from are built once and shared through that folder's .cache.
 *
 *   bun run test:scenarios [name filter]
 */
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readdir, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const filter = process.argv[2] ?? "";

// A port nothing listens on now, for the scenario's own web app.
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string")
    throw new Error("No free port was given");
  return address.port;
}

const files = (await readdir(import.meta.dir))
  .filter((file) => /^s\d+-.*\.test\.ts$/.test(file) && file.includes(filter))
  .sort();
const out = await mkdtemp(join(tmpdir(), "builder-scenarios-"));
await mkdir(join(out, ".cache"));
const port = await freePort();
console.log(`${String(files.length)} scenarios, output in ${out}`);

let failed = 0;
let total = 0;
for (const file of files) {
  const name = file.replace(/\.test\.ts$/, "");
  const dir = join(out, name);
  await mkdir(dir);
  await symlink(join(out, ".cache"), join(dir, ".cache"));
  const log = openSync(join(dir, "run.log"), "w");
  const started = performance.now();
  const run = Bun.spawn(
    [
      "bun",
      "--env-file=.env.hub",
      "--conditions=intx-src",
      "test",
      join(import.meta.dir, file),
    ],
    {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        SCENARIO_DIR: dir,
        DEMO_WEB_PORT: String(port),
      }),
      stdout: log,
      stderr: log,
    },
  );
  const code = await run.exited;
  closeSync(log);
  const seconds = (performance.now() - started) / 1_000;
  total += seconds;
  if (code !== 0) failed += 1;
  console.log(
    `${code === 0 ? "pass" : "FAIL"}  ${seconds.toFixed(0).padStart(5)}s  ${name}${code === 0 ? "" : `  (${join(dir, "run.log")})`}`,
  );
}
console.log(
  `${String(files.length - failed)} passed, ${String(failed)} failed, ${total.toFixed(0)}s in all`,
);
process.exit(failed === 0 ? 0 : 1);
