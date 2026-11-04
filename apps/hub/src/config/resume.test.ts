import { expect, test } from "bun:test";
import {
  ASKING_HANDOFF_OPENING,
  HANDOFF_OPENING,
  resumeContext,
  resumeMessage,
  withoutResumeContext,
} from "./resume.ts";

// The hub mails the handoff note as the person so the replacement coordinator acts on it; shown in
// the conversation, it would read as something the person said.
test("the hub's handoff note never shows as the person's message", () => {
  const context = resumeContext({
    turns: [{ role: "person", text: "Build a weather app", at: 1 }],
    awaiting: [],
    withApp: false,
  });
  expect(withoutResumeContext(HANDOFF_OPENING)).toBeUndefined();
  expect(withoutResumeContext(ASKING_HANDOFF_OPENING)).toBeUndefined();
  expect(
    withoutResumeContext(resumeMessage(context, HANDOFF_OPENING)),
  ).toBeUndefined();
  expect(withoutResumeContext(resumeMessage(context, "Go ahead"))).toBe(
    "Go ahead",
  );
});
