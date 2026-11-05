import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedResultTools } from "./saved-result-tools.ts";

test("the saved-result read_file returns a saved result and refuses every file", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "saved-result-"));
  await writeFile(join(workdir, "secret.txt"), "SECRET");
  const tools = savedResultTools({
    workdir,
    storage: {
      readBlob: async (key: string) => new TextEncoder().encode(`blob ${key}`),
    },
  } as never);
  const read = (path: string) =>
    tools.run(
      { id: "c", name: "read_file", arguments: { path } },
      new AbortController().signal,
    );
  expect((await read("tool-output:///abc")).content).toContain("blob abc");
  expect((await read("tool-output://abc")).content).toContain("blob abc");
  for (const path of [join(workdir, "secret.txt"), "secret.txt"]) {
    const result = await read(path);
    expect(result.isError).toBe(true);
    expect(result.content).not.toContain("SECRET");
  }
  await rm(workdir, { recursive: true });
});
