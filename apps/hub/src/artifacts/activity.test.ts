import { expect, test } from "bun:test";
import { createSidecarEmitter } from "@intx/hub-sessions";
import { createAgentActivity } from "./activity.ts";

const runId = "run_04ba732b8686649f77a2797393bafbc5";

test("a turn resumed after a restart, with no message run, ends on its reply", () => {
  const events = createSidecarEmitter();
  const activity = createAgentActivity(events);
  const send = (event: unknown) =>
    events.emit("agent.event", {
      agentAddress: `${runId}@sunny-harbor-panda.localhost`,
      sessionId: "session",
      event,
    });
  send({
    type: "tool.start",
    seq: 1,
    data: { call: { id: "call-1", name: "write_artifact", arguments: {} } },
  });
  expect(activity.of(runId).working).toBe(true);
  send({ type: "connector.reply", seq: 2, data: { content: "Done." } });
  expect(activity.of(runId).working).toBe(false);
  activity.dispose();
});
