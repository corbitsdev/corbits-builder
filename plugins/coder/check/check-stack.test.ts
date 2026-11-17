import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("check-stack passes only when every command in CHECKS.txt and BUILDER-CHECKS.txt succeeds", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "check-stack-"));
  const script = join(import.meta.dir, "check-stack.ts");
  const run = async (checks: string, builderChecks = "") => {
    await writeFile(join(workspace, "CHECKS.txt"), checks);
    await writeFile(join(workspace, "BUILDER-CHECKS.txt"), builderChecks);
    const child = Bun.spawn(["bun", script], {
      cwd: workspace,
      stdout: "pipe",
    });
    const content = await new Response(child.stdout).text();
    const code = await child.exited;
    return { code, content };
  };
  try {
    expect(await run("echo one\n\necho two\n")).toEqual({
      code: 0,
      content: expect.stringContaining("check passed:"),
    });
    expect(await run("echo one\nfalse\necho three\n")).toEqual({
      code: 1,
      content: expect.stringContaining("check failed:"),
    });
    expect(await run("echo one\n", "false\n")).toEqual({
      code: 1,
      content: expect.stringContaining("check failed:"),
    });
    expect(await run("", "echo two\n")).toEqual({
      code: 1,
      content: expect.stringContaining("check failed:"),
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
