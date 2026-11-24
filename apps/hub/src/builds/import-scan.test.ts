import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { undeclaredImports } from "./import-scan.ts";

test("an import is installed only for a project with a package.json", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "import-scan-")),
  );
  try {
    await writeFile(join(workspace, "app.ts"), 'import { z } from "zod";\n');
    expect(await undeclaredImports(workspace, "app.ts")).toBeUndefined();
    await writeFile(join(workspace, "package.json"), '{"name":"app"}');
    expect(await undeclaredImports(workspace, "app.ts")).toEqual({
      directory: "",
      packages: ["zod"],
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
