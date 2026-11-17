import { expect, test } from "bun:test";
import { CheckList } from "@corbits-builder/schemas/artifact";
import {
  call,
  calls,
  CHECK_STACK_MS,
  execute,
  ok,
  openProject,
  results,
  say,
  turn,
  user,
} from "../support/scripted-project.ts";

const INSTRUCTION =
  "Build the echo command-line tool from the build plan: it prints back the words it is given.";
const REPORT =
  "Your echo tool is built: it prints back whatever you give it, its tests pass and check-stack passed.";
// The bare starter's CHECKS.txt, which the coder reports as the project's checks.
const CHECKS = [
  "bun install --frozen-lockfile",
  "bun run typecheck",
  "bun run test",
  "bun run build",
];
const PROGRAM = `// Prints its arguments back, joined by spaces, the way the shell's echo does.
export function echo(args: readonly string[]): string {
  return args.join(" ");
}

if (import.meta.main) console.log(echo(Bun.argv.slice(2)));
`;
const passingTest = `import { expect, test } from "bun:test";
import { echo } from "./index.ts";

test("prints back every argument, joined by spaces", () => {
  expect(echo(["hello", "there"])).toBe("hello there");
});
`;
const write = (id: string, path: string, content: string) =>
  call(id, "write_file", { path, content });

test("a command-line tool built from the bare starter finishes on the checks its coder reports, and the hub's builds check runs those same commands", async () => {
  const project = await openProject({
    start: {
      idea: "I want a command-line tool that echoes things back to me.",
      title: "Echo",
    },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(
            user("command-line tool"),
            say("Tell me when the plan is filed."),
          ),
          turn(
            user("build it"),
            execute("c_build", "coder", "build", {
              starter: "bare",
              instruction: INSTRUCTION,
            }),
          ),
          turn(
            results(ok("c_build", "execute")),
            say("A coder is building it."),
          ),
          turn(user(REPORT), say("Your echo tool is built.")),
        ],
      },
      coder: {
        role: "coder",
        turns: [
          turn(
            user(INSTRUCTION),
            calls(
              write("coder_program", "src/index.ts", PROGRAM),
              write("coder_test", "src/index.test.ts", passingTest),
            ),
          ),
          turn(
            results(
              ok("coder_program", "write_file"),
              ok("coder_test", "write_file"),
            ),
            call("coder_values", "report_values", {
              values: [{ name: "stack.checks", value: CHECKS.join("\n") }],
            }),
          ),
          turn(
            results(ok("coder_values", "report_values")),
            call("coder_check", "run_shell", {
              command: "check-stack",
              timeout: CHECK_STACK_MS,
            }),
          ),
          turn(
            results(
              ok("coder_check", "run_shell", "The app is filed as version"),
            ),
            say(REPORT),
          ),
        ],
      },
    },
  });
  try {
    await project.heard("Tell me when the plan is filed.");
    const plan = await project.call("POST", `${project.path}/artifacts`, {
      kind: "build_plan",
      title: "Build plan",
      content:
        "## In short\nA TypeScript command-line tool on Bun that prints back the words it is given, with tests.",
    });
    expect(plan.status).toBe(200);
    await project.say("The plan is filed, build it.");
    await project.filed("app", 1);
    await project.heard("Your echo tool is built.");
    const finished = project.resultOf("coder_check").text;
    for (const command of CHECKS) expect(finished).toContain(`✓ ${command}`);

    expect(await project.values(["stack.starter", "stack.checks"])).toEqual({
      "stack.starter": "bare",
      "stack.checks": CHECKS.join("\n"),
    });
    const builds = CheckList.assert(
      (await project.call("GET", `${project.path}/checks`)).body,
    ).checks.find(
      ({ plugin, action }) => plugin === "coder" && action === "builds",
    );
    expect(builds).toMatchObject({ result: "pass", current: true });
    expect(builds?.summary).toContain(CHECKS.join(", then "));
    // Nothing to preview: the project serves no web app.
    expect((await project.call("GET", `${project.path}/app`)).status).toBe(409);
    await project.finish();
  } finally {
    await project.close();
  }
}, 900_000);
