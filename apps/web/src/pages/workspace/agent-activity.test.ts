import { expect, test } from "bun:test";
import { activityPhrase, readStep } from "./agent-activity.ts";

const coder = {
  runId: "run-coder",
  role: "coder" as const,
  since: "2026-11-02T01:41:30.000Z",
  tools: [
    {
      name: "read_file",
      subject: ".inputs/brief.md",
      running: true,
      at: "2026-11-02T01:41:31.000Z",
    },
  ],
};

test("a long command's own word on its progress replaces the reading of the call", () => {
  expect(activityPhrase(coder)).toMatch(/brief/);
  expect(
    activityPhrase({
      ...coder,
      command: {
        line: "installing the app's packages",
        at: "2026-11-02T01:41:40.000Z",
      },
    }),
  ).toBe("installing the app's packages");
});

test("a command opens onto itself, the end of its output and a failing exit code", () => {
  const step = readStep(
    "run_shell",
    { command: "bun test" },
    true,
    "exit code 1\n1 pass\n1 fail",
  );
  expect(step).toEqual({
    label: "bun test",
    command: "bun test",
    output: "1 pass\n1 fail\n\nExit code 1",
    face: "code",
  });
  expect(
    readStep("run_shell", { command: "bun test" }, true, "2 pass").output,
  ).toBe("2 pass");
});

test("a check opens onto each check with a tick or a cross and why one failed", () => {
  const step = readStep(
    "run_done_checks",
    { plugin: "coder", checks: ["build", "tests"] },
    true,
    JSON.stringify({
      results: [
        { check: "build", result: "pass", summary: "built", evidence: [] },
        {
          check: "tests",
          result: "fail",
          summary: "1 test failed",
          evidence: ["expected 2, got 3"],
        },
      ],
    }),
  );
  expect(step.output).toBe(
    "✓ build\n✗ tests\n    1 test failed\n    expected 2, got 3",
  );
  expect(step.face).toBe("code");
  const design = readStep(
    "check_design",
    {},
    true,
    'check passed\n✓ check-app\nFiled design_option: {"artifactId":"a","kind":"design_option","version":2}',
  );
  expect(design.output).toBe("check passed\n✓ check-app\nFiled as version 2");
});

test("a structured result opens onto a few labelled lines, never the object", () => {
  const filed = readStep(
    "write_artifact",
    { kind: "build_plan" },
    true,
    JSON.stringify({ artifactId: "a", kind: "build_plan", version: 3 }),
  );
  expect(filed.output).toBe("Version 3");
  const other = readStep(
    "some_new_tool",
    {},
    true,
    JSON.stringify({ slideCount: 4, nested: { a: 1 }, passed: true }),
  );
  expect(other.output).toBe("Slide count: 4\nPassed: true");
  expect(other.face).toBe("words");
  expect(readStep("plan", { operation: "show" }, true, "{}").output).toBe(
    undefined,
  );
});
