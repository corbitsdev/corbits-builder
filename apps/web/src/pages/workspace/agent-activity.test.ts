import { expect, test } from "bun:test";
import { activityPhrase, namesTool, readStep } from "./agent-activity.tsx";

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

// Every tool the hub offers a specialist or the coordinator, and the coder's browser.
const HUB_TOOLS = [
  "read_file",
  "write_file",
  "edit_file",
  "search_files",
  "grep",
  "run_shell",
  "app_status",
  "install_packages",
  "run_done_checks",
  "check_design",
  "file_design_option",
  "read_skill",
  "read_artifact",
  "write_artifact",
  "report_values",
  "write_deck",
  "check_deck",
  "file_package",
  "discover",
  "execute",
  "plan",
  "runs",
  "question",
  ...[
    "navigate",
    "navigate_back",
    "tabs",
    "close",
    "snapshot",
    "find",
    "click",
    "type",
    "fill_form",
    "select_option",
    "press_key",
    "hover",
    "drag",
    "handle_dialog",
    "evaluate",
    "emulate_media",
    "wait_for",
    "resize",
    "console_messages",
    "network_requests",
    "network_request",
    "take_screenshot",
    "run_code_unsafe",
    "file_upload",
    "drop",
  ].map((tool) => `browser.browser_${tool}`),
];

test("every tool the agents can call has its own words", () => {
  expect(HUB_TOOLS.filter((name) => !namesTool(name))).toEqual([]);
  expect(readStep("some_new_tool", {}, true, undefined).label).toBe(
    "Some new tool",
  );
});

test("a step's row says what happened, by tool family", () => {
  const label = (name: string, input: unknown) =>
    readStep(name, input, true, undefined).label;
  expect(label("write_file", { path: "src/index.ts", content: "x" })).toBe(
    "Wrote src/index.ts",
  );
  expect(label("run_shell", { command: "bun run check-stack" })).toBe(
    "Ran the project's checks",
  );
  expect(label("file_design_option", { concept: "Calm" })).toBe(
    "Filed the design option",
  );
  expect(label("read_artifact", { kind: "product_requirements" })).toBe(
    "Read the product requirements",
  );
  expect(
    label("report_values", {
      "stack.language": "TypeScript",
      "stack.checks": ["bun test"],
    }),
  ).toBe("Saved the language and checks");
  expect(label("install_packages", { packages: ["hono"] })).toBe(
    "Installed hono",
  );
  expect(label("app_status", { command: "bun run dev" })).toBe(
    "Started the app",
  );
  expect(label("plan", { operation: "set" })).toBe("Updated the plan");
  expect(label("browser.browser_navigate", { url: "http://127.0.0.1" })).toBe(
    "Opened the app's page",
  );
  expect(
    readStep("write_file", { path: "src/index.ts" }, false, undefined).label,
  ).toBe("Writing src/index.ts");
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

test("a written file opens onto nothing that repeats its row", () => {
  const written = readStep(
    "write_file",
    { path: "src/index.ts", content: "x" },
    true,
    "wrote 40815 bytes to src/index.ts",
  );
  expect(written.output).toBeUndefined();
  expect(
    readStep(
      "edit_file",
      { path: "src/a.ts" },
      true,
      "replaced 3 occurrence(s) in src/a.ts",
    ).output,
  ).toBe("Changed in 3 places");
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
