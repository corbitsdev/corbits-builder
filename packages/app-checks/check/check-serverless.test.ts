import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "check-serverless.ts");

// An app with these files, its worker checked from its root by the entry named.
async function checked(
  files: Record<string, string>,
  entry: string[] = ["src/worker.ts"],
) {
  const root = await mkdtemp(join(tmpdir(), "check-serverless-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "dist"));
    for (const [path, text] of Object.entries(files))
      await writeFile(join(root, path), text);
    const run = Bun.spawnSync(["bun", SCRIPT, ...entry], { cwd: root });
    return { code: run.exitCode, output: run.stdout.toString() };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("a worker that answers through its exported fetch and uses the host's Node modules passes, and its host's own modules only when the app's line names the host's scheme", async () => {
  const { code, output } = await checked({
    "src/worker.ts":
      'import { Buffer } from "node:buffer";\n// Bun.file is not used here.\nexport default { fetch: () => new Response(Buffer.from("ok")) };\n',
  });
  expect(output).toContain("check passed");
  expect(code).toBe(0);

  const files = {
    "src/worker.ts":
      'import { env } from "cloudflare:workers";\nexport default { fetch: () => new Response(String(env)) };\n',
  };
  const named = await checked(files, ["src/worker.ts", "cloudflare:"]);
  expect(named.output).toContain("check passed");
  expect(named.code).toBe(0);
  expect((await checked(files)).code).toBe(1);
});

test("a worker that reaches the disk, uses Bun or listens on a port fails, naming each file", async () => {
  const { code, output } = await checked({
    "src/worker.ts":
      'import { load } from "./data.ts";\nexport default { fetch: async () => new Response(await load()) };\n',
    "src/data.ts":
      'import { readFile } from "node:fs/promises";\nexport const load = () => readFile("data.json", "utf8");\nexport const file = Bun.file("x");\nexport const listen = (server: { listen(port: number): void }) => server.listen(3000);\n',
  });
  expect(code).toBe(1);
  expect(output).toContain("src/data.ts imports node:fs/promises");
  expect(output).toContain("src/data.ts:3 uses the Bun global (Bun.file)");
  expect(output).toContain("src/data.ts:4 listens on a port");
});

test("a built module is checked as the source its linked map leads back to", async () => {
  const worker =
    'import { readFile } from "node:fs/promises";\nexport default { fetch: async () => new Response(await readFile("x")) };\n';
  const { code, output } = await checked(
    {
      "src/worker.ts": worker,
      "dist/worker.js":
        "export default {};\n//# sourceMappingURL=worker.js.map\n",
      "dist/worker.js.map": JSON.stringify({
        version: 3,
        sources: ["../src/worker.ts"],
        mappings: "",
      }),
    },
    ["dist/worker.js"],
  );
  expect(code).toBe(1);
  expect(output).toContain("src/worker.ts imports node:fs/promises");
});
