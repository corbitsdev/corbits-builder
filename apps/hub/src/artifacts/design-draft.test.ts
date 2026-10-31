import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDesignDraft } from "./design-draft.ts";

test("the draft serves only regular files inside .builder/designs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sb-design-draft-"));
  const workspace = join(root, "workspace");
  const designs = join(workspace, ".builder", "designs");
  const outside = join(root, "home");
  try {
    await mkdir(join(designs, "screens"), { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret\n");
    await writeFile(join(outside, "index.html"), "<p>outside</p>");
    await writeFile(join(workspace, ".builder", "DESIGN.md"), "# Design\n");
    await writeFile(join(workspace, "package.json"), "{}");
    await writeFile(join(designs, "index.html"), "<p>mockup</p>");
    await writeFile(join(designs, "screens", "list.html"), "<p>list</p>");
    await writeFile(join(designs, ".env"), "SECRET=1\n");
    await symlink(join(outside, "secret.txt"), join(designs, "secret.txt"));
    await symlink(outside, join(designs, "home"));
    expect(await readDesignDraft(workspace)).toEqual({
      "designs/index.html": "<p>mockup</p>",
      "designs/screens/list.html": "<p>list</p>",
    });

    await rm(designs, { recursive: true });
    await symlink(outside, designs);
    expect(await readDesignDraft(workspace)).toBeUndefined();

    await rm(join(workspace, ".builder"), { recursive: true });
    await mkdir(join(outside, "designs"));
    await writeFile(join(outside, "designs", "index.html"), "<p>outside</p>");
    await symlink(outside, join(workspace, ".builder"));
    expect(await readDesignDraft(workspace)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
