import { expect, test } from "bun:test";
import { wording } from "../../config.ts";
import { activityPhrase, toolResult } from "./agent-activity.tsx";

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

test("a call whose raw result means nothing to a person is described in plain words", () => {
  expect(toolResult("exec", "unknown tool: exec")).toBe(
    wording.activity.toolResult["exec"],
  );
  expect(toolResult("read_file", '{"lines":3}')).toEqual({ lines: 3 });
});
