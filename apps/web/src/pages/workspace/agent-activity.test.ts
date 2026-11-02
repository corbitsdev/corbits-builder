import { expect, test } from "bun:test";
import { activityPhrase } from "./agent-activity.tsx";

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
  expect(activityPhrase(coder).phrase).toMatch(/brief/);
  expect(
    activityPhrase({
      ...coder,
      command: {
        line: "installing the app's packages",
        at: "2026-11-02T01:41:40.000Z",
      },
    }),
  ).toEqual({ phrase: "installing the app's packages", asking: false });
});
