import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckRan } from "@corbits-builder/schemas/artifact";
import { importRepository } from "../../../scripts/import-repo.ts";
import { openProject, say, turn, user } from "../support/scripted-project.ts";
import { toolReplay } from "../support/tool-replay.ts";

const TOOL_REPLAY = toolReplay(
  join(import.meta.dir, "../../fixtures/tools/existing-project"),
);

const STACK = ["stack.starter", "stack.checks"];
const WEB_CHECKS =
  "bun install --frozen-lockfile\nbun run typecheck\nbun run build";

test("a project in the main line's stored shape gets a coordinator on this code, and its builds check runs the web starter's commands", async () => {
  const project = await openProject({
    start: { seed: "habit-tracker" },
    toolReplay: TOOL_REPLAY,
    runs: {
      coordinator: {
        role: "coordinator",
        // The hub's note of the check the person ran.
        turns: [turn(user(), say("I saw the build check."))],
      },
    },
  });
  try {
    expect(await project.values(STACK)).toEqual({
      "stack.starter": "web-app",
      "stack.checks": WEB_CHECKS,
    });
    const checked = await project.call("POST", `${project.path}/checks`, {
      plugin: "coder",
      action: "builds",
    });
    expect(checked.status).toBe(200);
    const ran = CheckRan.assert(checked.body);
    if (!("ran" in ran)) throw new Error("The builds check did not run once");
    // The seeded app has no typecheck script, so the type-check step fails; reaching it shows the
    // install ran first and passed, and the build step after it never ran.
    expect(ran.summary).toStartWith("bun run typecheck exited");
    await project.heard("I saw the build check.");
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);

// A command-line tool in Go: no package.json, nothing a web starter's commands could build.
const GO_TOOL = {
  "go.mod": "module example.com/greet\n\ngo 1.22\n",
  "main.go":
    'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello")\n}\n',
  "README.md": "# greet\n\nPrints hello.\n",
};

test("an imported repository that is not a web app is not given the web starter's commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "builder-e2e-go-"));
  try {
    for (const [path, content] of Object.entries(GO_TOOL))
      await writeFile(join(directory, path), content);
    const { file } = await importRepository(directory, { title: "Greet" });
    const project = await openProject({
      start: { file },
      toolReplay: TOOL_REPLAY,
      runs: {
        coordinator: {
          role: "coordinator",
          turns: [
            turn(
              user("I just imported this project"),
              say("The project is imported."),
            ),
          ],
        },
      },
    });
    try {
      await project.heard("The project is imported.");
      const stack = await project.values(STACK);
      expect(stack["stack.starter"]).not.toBe("web-app");
      expect(stack["stack.checks"]).not.toBe(WEB_CHECKS);
      await project.finish();
    } finally {
      await project.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 600_000);
