import { expect } from "bun:test";
import { CheckList } from "@corbits-builder/schemas/artifact";
import { writerFiles } from "./specialists.ts";
import {
  call,
  calls,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

const idea = "I want a CLI tool that echoes things back to me.";
const requirementsFiled = "The echo tool's requirements are filed.";
const planFiled = "The echo tool's build plan is filed.";
const report =
  "Your echo tool is built: it prints back whatever you give it, its tests pass and check-project passed.";
const BARE_CODER_TOOLS = ["write_file", "run_shell", "mail_reply"];

const program = `// Prints its arguments back, joined by spaces, the way the shell's echo does.
export function echo(args: readonly string[]): string {
  return args.join(" ");
}

if (import.meta.main) console.log(echo(Bun.argv.slice(2)));
`;
const programTest = `import { expect, test } from "bun:test";
import { echo } from "./index.ts";

test("prints back every argument, joined by spaces", () => {
  expect(echo(["hello", "there"])).toBe("hello there");
});

test("prints an empty line when given nothing", () => {
  expect(echo([])).toBe("");
});
`;
const readme = `# Echo

A command-line tool that prints back whatever it is given.

\`\`\`sh
bun install
bun run start hello there
\`\`\`

prints \`hello there\`.

## Commands

- \`bun run start <words>\`: prints the words back.
- \`bun run test\`: runs the tests.
- \`bun run build\`: bundles the tool into \`dist/\`.

## Layout

- \`src/index.ts\`: the tool.
- \`src/index.test.ts\`: its tests.
`;

/** The person approves the first version of the document of the kind when asked to. */
async function approveFirst(p: Person, kind: string) {
  const filed = await p.filed(kind, 1);
  await p.question();
  const answered = await p.answer({
    output: { approved: [{ kind, artifactId: filed.artifactId, version: 1 }] },
  });
  expect(answered.status).toBe(200);
}

scenario({
  name: "s38-build-a-cli",
  title:
    "a command-line tool is built from the bare starter: requirements and a build plan the person approves, coder build with starter bare, a coder that passes check-project, the hub's builds check, the app filed, and stack.starter recorded so the project serves no web app to preview",
  start: { fresh: idea },
  coordinator: [
    turn(
      user("CLI tool"),
      execute("c_requirements", "writer", "write-requirements", {
        instruction:
          "A command-line tool that prints back whatever words it is given, the way the shell's echo does.",
      }),
    ),
    turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
    turn(
      user(requirementsFiled),
      execute("c_approve_requirements", "writer", "approve", {
        kinds: ["product_requirements"],
      }),
    ),
    turn(
      results(ok("c_approve_requirements", "execute", '"approved"')),
      execute("c_plan", "writer", "write-build-plan", {
        instruction:
          "Plan the build of the approved requirements: a TypeScript command-line tool on Bun, with tests.",
      }),
    ),
    turn(results(ok("c_plan", "execute")), say("A writer is planning it.")),
    turn(
      user(planFiled),
      execute("c_approve_plan", "writer", "approve", {
        kinds: ["build_plan"],
      }),
    ),
    turn(
      results(ok("c_approve_plan", "execute", '"approved"')),
      execute("c_build", "coder", "build", {
        starter: "bare",
        instruction:
          "Build the echo command-line tool from the approved requirements and build plan.",
      }),
    ),
    turn(results(ok("c_build", "execute")), say("A coder is building it.")),
    turn(user(report), say("Your echo tool is built.")),
  ],
  specialists: {
    requirements: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "prints back whatever words it is given",
        kind: "product_requirements",
        content:
          "## In short\nA command-line tool that prints back the words it is given.\n\n## Requirements\n- R-1: `echo hello there` prints `hello there`.\n- R-2: With no words it prints an empty line.",
        report: requirementsFiled,
      }),
    },
    plan: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "Plan the build of the approved requirements",
        kind: "build_plan",
        content:
          "## Stack\nTypeScript on Bun, one package, no framework.\n\n## Acceptance checklist\n- [ ] R-1: the words given are printed back, joined by spaces.\n- [ ] R-2: no words print an empty line.\n- [ ] The tests and check-project pass.",
        report: planFiled,
      }),
    },
    coder: {
      role: "coder",
      turns: [
        turn(
          user("Build the echo command-line tool"),
          calls(
            call("coder_program", "write_file", {
              path: "src/index.ts",
              content: program,
            }),
            call("coder_test", "write_file", {
              path: "src/index.test.ts",
              content: programTest,
            }),
            call("coder_readme", "write_file", {
              path: "README.md",
              content: readme,
            }),
          ),
          BARE_CODER_TOOLS,
        ),
        turn(
          results(
            ok("coder_program", "write_file"),
            ok("coder_test", "write_file"),
            ok("coder_readme", "write_file"),
          ),
          call("coder_check", "run_shell", {
            command: "check-project",
            timeout: 120_000,
          }),
          BARE_CODER_TOOLS,
        ),
        turn(
          results(
            ok("coder_check", "run_shell", "The app is filed as version"),
          ),
          say(report),
          BARE_CODER_TOOLS,
        ),
      ],
    },
  },
  values: ["stack.starter"],
  person: async (p) => {
    await approveFirst(p, "product_requirements");
    await approveFirst(p, "build_plan");
    await p.filed("app", 1);
    await p.heard("Your echo tool is built.");

    p.note("coder build returned", p.resultOf("c_build").text);
    const assignment = p.assignment("coder");
    p.note("the coder's assignment", assignment);
    expect(assignment).not.toContain(".builder/DESIGN.md");

    const checked = p.resultOf("coder_check").text;
    p.note("check-project in the coder's workspace", checked);
    expect(checked).toContain("check passed: typechecked, tested and built");

    const reports = p.messages("coordinator");
    expect(reports.some((message) => message.includes(report))).toBe(true);

    const listed = await p.call("GET", `${p.path}/checks`);
    const builds = CheckList.assert(listed.body).checks.find(
      (check) => check.plugin === "coder" && check.action === "builds",
    );
    p.note("coder builds' latest record", builds);
    expect(builds).toMatchObject({ result: "pass", current: true });

    const values = await p.call(
      "GET",
      `${p.path}/values?keys=${encodeURIComponent("stack.starter")}`,
    );
    p.note("the project's stack.starter", values.body);
    expect(values.body).toEqual({ values: { "stack.starter": "bare" } });

    const preview = await p.call("GET", `${p.path}/app`);
    p.note("the live preview of a project that serves no web app", preview);
    expect(preview.status).toBe(409);
    expect(JSON.stringify(preview.body)).toContain("no_web_app");
  },
});
