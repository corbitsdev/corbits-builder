import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesignCheck, DESIGNS } from "./design-check.ts";

test("a design file that cannot be read fails the check instead of being left out of what it saw", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sb-design-check-"));
  const screen = join(workspace, DESIGNS, "screen.html");
  let runs = 0;
  const check = createDesignCheck(workspace, async () => {
    runs += 1;
    return { exitCode: 0, output: "check passed" };
  });
  try {
    await mkdir(join(workspace, DESIGNS), { recursive: true });
    await writeFile(screen, "<main></main>\n");
    await chmod(screen, 0o000);
    await expect(
      check.current(new AbortController().signal),
    ).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(runs).toBe(0);
  } finally {
    check.dispose();
    await chmod(screen, 0o644);
    await rm(workspace, { recursive: true, force: true });
  }
});
