import { describe, expect, test } from "bun:test";
import { createRunSpans, type FinishedSpan } from "./run-spans.ts";

const agent = {
  address: "run_a-step@example.com",
  runId: "run_a",
  tenantId: "tenant_a",
  projectId: "project_a",
  role: "designer",
  effort: "high",
  profile: "openai_default",
  packageVersion: "0.35.0",
};
const secret = "distinctive-content-keep-private";
const events = [
  {
    type: "message.run.started",
    seq: 1,
    data: { messageRunId: "message-run", receivedAt: 1 },
  },
  { type: "inference.start", seq: 2, data: { model: "requested" } },
  {
    type: "inference.done",
    seq: 3,
    data: {
      turn: {
        role: "assistant",
        model: "actual",
        timestamp: 1,
        content: [{ type: "text", text: secret }],
      },
      usage: {
        input: 12,
        output: 34,
        cacheRead: 5,
        cacheWrite: 7,
        thinking: 0,
      },
      source: { provider: "provider", model: "actual", sourceId: "source" },
    },
  },
  {
    type: "tool.start",
    seq: 4,
    data: {
      call: { id: "call", name: "read_file", arguments: { path: secret } },
    },
  },
  {
    type: "tool.done",
    seq: 5,
    data: { result: { callId: "call", content: secret } },
  },
  {
    type: "message.run.ended",
    seq: 6,
    data: { messageRunId: "message-run", status: "completed" },
  },
];

describe("run spans", () => {
  test("exports a turn, model and tool with their parents and arrival times", () => {
    const tracker = createRunSpans({ captureContent: false });
    const spans = events.flatMap((event, index) =>
      tracker.accept(agent.address, agent.runId, agent, event, 100 + index),
    );
    expect(spans).toHaveLength(3);
    const [model, tool, turn] = spans;
    expect(turn).toMatchObject({
      kind: "turn",
      traceKey: "message-run",
      key: "turn",
      startTime: 100,
      endTime: 105,
    });
    expect(turn?.parentKey).toBeUndefined();
    expect(model).toMatchObject({
      name: "chat requested",
      kind: "model",
      parentKey: turn?.key,
      traceKey: turn?.traceKey,
      // The call began when the turn did, not when its held-back start event arrived.
      startTime: 100,
      endTime: 102,
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "requested",
        "gen_ai.response.model": "actual",
        "gen_ai.provider.name": "provider",
        "gen_ai.usage.input_tokens": 24,
        "gen_ai.usage.output_tokens": 34,
        "gen_ai.usage.cache_read.input_tokens": 5,
        "gen_ai.usage.cache_creation.input_tokens": 7,
      },
    });
    expect(tool).toMatchObject({
      name: "execute_tool read_file",
      kind: "tool",
      parentKey: turn?.key,
      traceKey: turn?.traceKey,
      startTime: 103,
      endTime: 104,
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "read_file",
        "gen_ai.tool.call.id": "call",
      },
    });
    for (const span of spans)
      expect(span.attributes).toMatchObject({
        "session.id": agent.projectId,
        "corbits.tenant.id": agent.tenantId,
        "corbits.project.id": agent.projectId,
        "corbits.agent.role": agent.role,
        "corbits.model.effort": agent.effort,
        "corbits.model.profile": agent.profile,
        "corbits.agent.package.version": agent.packageVersion,
        "corbits.run.id": agent.runId,
        "corbits.agent.address": agent.address,
      });
    expect(
      tracker.accept(agent.address, agent.runId, agent, events[1], 200),
    ).toEqual([]);
    expect(
      tracker.accept(agent.address, agent.runId, agent, events[2], 201),
    ).toEqual([]);
  });

  test("exports unknown projects", () => {
    const tracker = createRunSpans({ captureContent: false });
    const unknown = { address: "unknown", runId: "unknown" };
    const spans = events.flatMap((event, index) =>
      tracker.accept(unknown.address, unknown.runId, {}, event, index),
    );
    expect(spans).toHaveLength(3);
    for (const span of spans) {
      expect(span.attributes["corbits.run.id"]).toBe(unknown.runId);
      expect(span.attributes["session.id"]).toBeUndefined();
      expect(span.attributes["corbits.project.id"]).toBeUndefined();
      expect(span.attributes["corbits.agent.role"]).toBeUndefined();
      expect(span.attributes["corbits.model.effort"]).toBeUndefined();
    }
  });

  test("the next model starts when the last parallel tool ends", () => {
    const tracker = createRunSpans({ captureContent: false });
    tracker.accept(agent.address, agent.runId, agent, events[0], 0);
    tracker.accept(agent.address, agent.runId, agent, events[1], 1);
    tracker.accept(agent.address, agent.runId, agent, events[2], 2);
    tracker.accept(agent.address, agent.runId, agent, events[3], 3);
    tracker.accept(
      agent.address,
      agent.runId,
      agent,
      {
        type: "tool.start",
        seq: 5,
        data: { call: { id: "parallel", name: "tool", arguments: {} } },
      },
      4,
    );
    tracker.accept(agent.address, agent.runId, agent, events[4], 5);
    tracker.accept(
      agent.address,
      agent.runId,
      agent,
      {
        type: "tool.done",
        seq: 7,
        data: { result: { callId: "parallel", content: "done" } },
      },
      6,
    );
    tracker.accept(agent.address, agent.runId, agent, events[1], 8);
    expect(
      tracker.accept(agent.address, agent.runId, agent, events[2], 8)[0]
        ?.startTime,
    ).toBe(6);
  });

  test("ends unfinished children and turns on run end, replacement and shutdown", () => {
    for (const reason of ["end", "replace", "shutdown"]) {
      const tracker = createRunSpans({ captureContent: false });
      tracker.accept(agent.address, agent.runId, agent, events[0], 0);
      tracker.accept(agent.address, agent.runId, agent, events[1], 1);
      tracker.accept(agent.address, agent.runId, agent, events[3], 2);
      let spans;
      if (reason === "shutdown") spans = tracker.shutdown(10);
      else
        spans = tracker.accept(
          agent.address,
          agent.runId,
          agent,
          reason === "end" ? events[5] : events[0],
          10,
        );
      expect(spans.map((span) => span.kind)).toEqual(["model", "tool", "turn"]);
      for (const span of spans) {
        expect(span.error).toBeDefined();
        expect(span.endTime).toBe(10);
      }
      if (reason === "replace") expect(tracker.shutdown(11)).toHaveLength(1);
      else expect(tracker.shutdown(11)).toEqual([]);
    }
  });

  test("exports evicted turns and their unfinished children", () => {
    const tracker = createRunSpans({ captureContent: false });
    tracker.accept(agent.address, agent.runId, agent, events[0], 0);
    tracker.accept(agent.address, agent.runId, agent, events[3], 1);
    let evicted: FinishedSpan[] = [];
    for (let index = 0; index < 1000; index++)
      evicted = tracker.accept(String(index), String(index), {}, events[0], 2);
    expect(evicted.map((span) => span.kind)).toEqual(["tool", "turn"]);
    for (const span of evicted) expect(span.error).toBeDefined();
    expect(
      tracker.accept(agent.address, agent.runId, agent, events[5], 3),
    ).toEqual([]);
  });

  test("only captures reply and tool content when enabled", () => {
    for (const captureContent of [false, true]) {
      const tracker = createRunSpans({ captureContent });
      const spans = events.flatMap((event, index) =>
        tracker.accept(agent.address, agent.runId, agent, event, index),
      );
      expect(JSON.stringify(spans).includes(secret)).toBe(captureContent);
      if (captureContent) {
        expect(spans[0]?.attributes["gen_ai.output.messages"]).toContain(
          secret,
        );
        expect(spans[1]?.attributes["gen_ai.tool.call.arguments"]).toContain(
          secret,
        );
        expect(spans[1]?.attributes["gen_ai.tool.call.result"]).toContain(
          secret,
        );
      }
    }
  });

  test("marks failed model calls, tools and turns", () => {
    const tracker = createRunSpans({ captureContent: false });
    tracker.accept(agent.address, agent.runId, agent, events[0], 0);
    tracker.accept(agent.address, agent.runId, agent, events[1], 1);
    expect(
      tracker.accept(
        agent.address,
        agent.runId,
        agent,
        {
          type: "inference.error",
          seq: 3,
          data: {
            error: { category: "fatal", message: "Model failed" },
            partial: { text: "" },
          },
        },
        2,
      )[0]?.error,
    ).toBe("Model failed");
    tracker.accept(agent.address, agent.runId, agent, events[3], 3);
    expect(
      tracker.accept(
        agent.address,
        agent.runId,
        agent,
        {
          type: "tool.done",
          seq: 5,
          data: {
            result: { callId: "call", content: "failed", isError: true },
          },
        },
        4,
      )[0]?.error,
    ).toBeDefined();
    expect(
      tracker.accept(
        agent.address,
        agent.runId,
        agent,
        {
          type: "message.run.ended",
          seq: 6,
          data: {
            messageRunId: "message-run",
            status: "failed",
            error: { message: "Turn failed" },
          },
        },
        5,
      )[0]?.error,
    ).toBe("Turn failed");
  });

  test("ignores malformed events", () => {
    const tracker = createRunSpans({ captureContent: false });
    tracker.accept(agent.address, agent.runId, agent, events[0], 0);
    expect(
      tracker.accept(
        agent.address,
        agent.runId,
        agent,
        { type: "tool.start", seq: 2, data: { call: { id: 123 } } },
        1,
      ),
    ).toEqual([]);
  });
});
