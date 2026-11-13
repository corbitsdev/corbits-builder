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
} from "./runner.ts";

const idea = "I want a small library that converts temperatures.";
const requirementsFiled = "The temperature library's requirements are filed.";
const report =
  "The temperature library is built from an empty project: its tests pass and check-stack passed.";
const TOOLS = ["write_file", "run_shell", "mail_reply", "report_values"];
const CHECKS =
  "bun install\nbun test\nbun build ./src/index.ts --target bun --outdir dist";
const STACK = { "stack.language": "TypeScript", "stack.checks": CHECKS };

const files = {
  "package.json": `${JSON.stringify(
    {
      name: "temperature",
      version: "0.1.0",
      private: true,
      type: "module",
      module: "src/index.ts",
    },
    null,
    2,
  )}\n`,
  "src/index.ts": `/** Degrees Celsius in degrees Fahrenheit. */
export const toFahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;

/** Degrees Fahrenheit in degrees Celsius. */
export const toCelsius = (fahrenheit: number) => ((fahrenheit - 32) * 5) / 9;
`,
  "src/index.test.ts": `import { expect, test } from "bun:test";
import { toCelsius, toFahrenheit } from "./index.ts";

test("water boils at 100 C, 212 F", () => {
  expect(toFahrenheit(100)).toBe(212);
  expect(toCelsius(212)).toBe(100);
});

test("-40 is the same on both scales", () => {
  expect(toFahrenheit(-40)).toBe(-40);
});
`,
  "README.md": `# Temperature

Converts temperatures between Celsius and Fahrenheit.

\`\`\`ts
import { toFahrenheit } from "./src/index.ts";
toFahrenheit(100); // 212
\`\`\`

## Commands

- \`bun test\`: runs the tests.
- \`bun build ./src/index.ts --target bun --outdir dist\`: bundles the library into \`dist/\`.
`,
  "CHECKS.txt": `${CHECKS}\n`,
};

scenario({
  name: "s42-build-from-empty-project",
  title:
    "coder build with no starter: the coder writes a Bun TypeScript library and its CHECKS.txt from an empty project, reports stack.language and stack.checks, passes check-stack, and the builds check passes by running those commands",
  start: { fresh: idea },
  coordinator: [
    turn(
      user("temperatures"),
      execute("c_requirements", "writer", "write-requirements", {
        instruction:
          "A small TypeScript library that converts temperatures between Celsius and Fahrenheit.",
      }),
    ),
    turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
    turn(
      user(requirementsFiled),
      execute("c_build", "coder", "build", {
        instruction:
          "Build the temperature library on Bun and TypeScript from the requirements, with tests.",
      }),
    ),
    turn(results(ok("c_build", "execute")), say("A coder is building it.")),
    turn(user(report), say("Your temperature library is built.")),
  ],
  specialists: {
    requirements: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "converts temperatures",
        kind: "product_requirements",
        content:
          "## In short\nA library that converts temperatures.\n\n## Requirements\n- R-1: 100 C is 212 F.\n- R-2: 212 F is 100 C.",
        report: requirementsFiled,
      }),
    },
    coder: {
      role: "coder",
      turns: [
        turn(
          user("Build the temperature library"),
          calls(
            ...Object.entries(files).map(([path, content], index) =>
              call(`coder_write_${String(index)}`, "write_file", {
                path,
                content,
              }),
            ),
          ),
          TOOLS,
        ),
        turn(
          results(
            ...Object.keys(files).map((_, index) =>
              ok(`coder_write_${String(index)}`, "write_file"),
            ),
          ),
          call("coder_stack", "report_values", STACK),
          TOOLS,
        ),
        turn(
          results(ok("coder_stack", "report_values", "TypeScript")),
          call("coder_check", "run_shell", {
            command: "check-stack",
            timeout: 120_000,
          }),
          TOOLS,
        ),
        turn(
          results(ok("coder_check", "run_shell", "check passed")),
          say(report),
          TOOLS,
        ),
      ],
    },
  },
  values: ["stack.language", "stack.checks", "stack.starter"],
  person: async (p) => {
    await p.filed("app", 1);
    await p.heard("Your temperature library is built.");
    p.note("coder build returned", p.resultOf("c_build").text);
    p.note(
      "check-stack in the coder's workspace",
      p.resultOf("coder_check").text,
    );

    const values = await p.call(
      "GET",
      `${p.path}/values?keys=stack.language,stack.checks,stack.starter`,
    );
    p.note("the project's stack values", values.body);
    // A first build from no starter clears stack.starter.
    expect(values.body).toEqual({
      values: {
        "stack.language": STACK["stack.language"],
        "stack.checks": STACK["stack.checks"],
        "stack.starter": null,
      },
    });

    const listed = await p.call("GET", `${p.path}/checks`);
    const builds = CheckList.assert(listed.body).checks.find(
      (check) => check.plugin === "coder" && check.action === "builds",
    );
    p.note("coder builds' latest record", builds);
    expect(builds).toMatchObject({ result: "pass", current: true });
  },
});
