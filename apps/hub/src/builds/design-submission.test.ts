import { designThemes } from "@corbits-builder/designer/skills" with { type: "macro" };
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createDesignSubmission } from "./design-submission.ts";

test("a workspace without a .builder folder still runs check-app and names the files it needs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "sb-design-check-"));
  let runs = 0;
  const check = createDesignSubmission(
    workspace,
    async () => {
      runs += 1;
      return {
        exitCode: 1,
        output: "check failed: 1 problem\n✗ .builder/designs has no index.html",
      };
    },
    async () => {
      throw new Error("must not file a missing design");
    },
  );
  try {
    const result = await check.run(
      { id: "check", name: "check_design", arguments: {} },
      new AbortController().signal,
    );
    expect(result.detail).toEqual({ checkPassed: false, filed: false });
    expect(result.content).toBe(
      "check failed: 1 problem\n✗ .builder/designs has no index.html\n✗ invalid_design: .builder needs DESIGN.md, designs/index.html and designs/styles.css",
    );
    expect(runs).toBe(1);
  } finally {
    check.dispose();
    await rm(workspace, { recursive: true, force: true });
  }
});

const checkCall = { id: "check", name: "check_design", arguments: {} };
const receipt = {
  artifactId: "design-1",
  kind: "design_option",
  version: 1,
  sha256: "a".repeat(64),
};

async function withDesign(
  run: (workspace: string, doc: string) => Promise<void>,
) {
  const workspace = await mkdtemp(join(tmpdir(), "sb-design-submit-"));
  const files = designThemes()["modern-sleek"]!;
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(workspace, ".builder", path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    await run(workspace, files["DESIGN.md"]!);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test("one check lists check-app's problems and an invalid DESIGN.md together", async () => {
  await withDesign(async (workspace, doc) => {
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      `${doc}\n<App name> goes here.\n`,
    );
    const submission = createDesignSubmission(
      workspace,
      async () => ({
        exitCode: 1,
        output: "check failed: 1 problem\n✗ /#/home overflows at 390 px",
      }),
      async () => receipt,
    );
    const result = await submission.run(
      checkCall,
      new AbortController().signal,
    );
    expect(result.detail).toEqual({ checkPassed: false, filed: false });
    expect(result.content).toBe(
      "check failed: 1 problem\n✗ /#/home overflows at 390 px\n✗ invalid_design: DESIGN.md still has 1 template placeholder(s): <App name>",
    );
    submission.dispose();
  });
});

test("a design without designs/index.html names the files it needs", async () => {
  await withDesign(async (workspace) => {
    await rm(join(workspace, ".builder", "designs", "index.html"));
    const submission = createDesignSubmission(
      workspace,
      async () => ({
        exitCode: 1,
        output: "check failed: 1 problem\n✗ .builder/designs has no index.html",
      }),
      async () => receipt,
    );
    const result = await submission.run(
      checkCall,
      new AbortController().signal,
    );
    expect(result.content).toBe(
      "check failed: 1 problem\n✗ .builder/designs has no index.html\n✗ invalid_design: .builder needs DESIGN.md, designs/index.html and designs/styles.css",
    );
    submission.dispose();
  });
});

test("check-app that cannot start still reports an invalid DESIGN.md", async () => {
  await withDesign(async (workspace, doc) => {
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      `${doc}\n<App name> goes here.\n`,
    );
    const submission = createDesignSubmission(
      workspace,
      async () => {
        throw new Error("spawn check-app ENOENT");
      },
      async () => receipt,
    );
    const result = await submission.run(
      checkCall,
      new AbortController().signal,
    );
    expect(result.detail).toEqual({ checkPassed: false, filed: false });
    expect(result.content).toBe(
      "check-app did not run: spawn check-app ENOENT\n✗ invalid_design: DESIGN.md still has 1 template placeholder(s): <App name>",
    );
    submission.dispose();
  });
});

test("a failed submission retries, while unchanged files reuse the receipt", async () => {
  await withDesign(async (workspace, doc) => {
    let checks = 0;
    let posts = 0;
    const submission = createDesignSubmission(
      workspace,
      async () => {
        checks += 1;
        return { exitCode: 0, output: "check passed\n✓ /#/home at 390 px" };
      },
      async () => {
        posts += 1;
        if (posts === 1) throw new Error("temporary filing failure");
        return receipt;
      },
    );
    const signal = new AbortController().signal;
    const unfiled = await submission.run(checkCall, signal);
    expect(unfiled.detail).toEqual({ checkPassed: false, filed: false });
    expect(unfiled.content).toBe(
      "check failed: temporary filing failure\n✓ /#/home at 390 px\n✗ temporary filing failure",
    );
    expect((await submission.run(checkCall, signal)).detail).toEqual({
      checkPassed: true,
      filed: true,
    });
    expect((await submission.run(checkCall, signal)).content).toContain(
      JSON.stringify(receipt),
    );
    expect(checks).toBe(2);
    expect(posts).toBe(2);
    const body = doc.replace(/^---\n[\s\S]*?\n---\n+/, "");
    await writeFile(
      join(workspace, ".builder", "DESIGN.md"),
      `---\nignored: true\n---\n\n${body}`,
    );
    expect((await submission.run(checkCall, signal)).detail).toEqual({
      checkPassed: true,
      filed: true,
    });
    expect(checks).toBe(3);
    expect(posts).toBe(3);
    submission.dispose();
  });
});

test("a file changed during checking is not filed, including files outside designs", async () => {
  await withDesign(async (workspace) => {
    let checks = 0;
    let posts = 0;
    const submission = createDesignSubmission(
      workspace,
      async () => {
        checks += 1;
        if (checks === 1)
          await writeFile(join(workspace, ".builder", "notes.txt"), "changed");
        return { exitCode: 0, output: "check passed" };
      },
      async () => {
        posts += 1;
        return receipt;
      },
    );
    const signal = new AbortController().signal;
    const stale = await submission.run(checkCall, signal);
    expect(stale.detail).toEqual({ checkPassed: false, filed: false });
    expect(stale.content).toContain("changed during checking");
    expect(posts).toBe(0);
    expect((await submission.run(checkCall, signal)).detail).toEqual({
      checkPassed: true,
      filed: true,
    });
    expect(posts).toBe(1);
    submission.dispose();
  });
});

test("an overlapping check is refused; cancellation prevents filing and releases the check for retry", async () => {
  await withDesign(async (workspace) => {
    const entered = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    let checks = 0;
    let posts = 0;
    const submission = createDesignSubmission(
      workspace,
      async (signal) => {
        checks += 1;
        entered.resolve(signal);
        await release.promise;
        return { exitCode: 0, output: "check passed" };
      },
      async () => {
        posts += 1;
        return receipt;
      },
    );
    const caller = new AbortController();
    const call = submission.run(checkCall, caller.signal);
    const operationSignal = await entered.promise;
    const duplicate = await submission.run(checkCall, caller.signal);
    expect(duplicate.detail).toBeUndefined();
    expect(duplicate.content).toContain("already running");
    expect(checks).toBe(1);
    expect(operationSignal.aborted).toBe(false);

    caller.abort(new Error("cancelled caller"));
    expect(operationSignal.aborted).toBe(true);
    release.resolve();
    await expect(call).rejects.toThrow("cancelled caller");
    expect(posts).toBe(0);
    expect(
      (await submission.run(checkCall, new AbortController().signal)).detail,
    ).toEqual({ checkPassed: true, filed: true });
    expect(checks).toBe(2);
    expect(posts).toBe(1);
    submission.dispose();
  });
});
