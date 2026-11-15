import { expect, test } from "bun:test";
import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createRunExport } from "./run-export.ts";
import { createRunSpans } from "./run-spans.ts";

test("children exported before their turn share its trace and parent id", async () => {
  const exporter = new InMemorySpanExporter();
  const output = createRunExport({}, exporter);
  expect(output).toBeDefined();
  if (!output) throw new Error("Exporter was not created");
  const tracker = createRunSpans({ captureContent: false });
  const agent = { address: "run-step@example.com", runId: "run" };
  tracker.accept(
    agent,
    {
      type: "message.run.started",
      seq: 1,
      data: { messageRunId: "turn-id", receivedAt: 1 },
    },
    100,
  );
  tracker.accept(
    agent,
    {
      type: "tool.start",
      seq: 2,
      data: { call: { id: "call", name: "tool", arguments: {} } },
    },
    101,
  );
  output.send(
    tracker.accept(
      agent,
      {
        type: "tool.done",
        seq: 3,
        data: { result: { callId: "call", content: "done" } },
      },
      102,
    ),
  );
  await output.flush();
  expect(exporter.getFinishedSpans()).toHaveLength(1);
  tracker.accept(
    agent,
    {
      type: "inference.start",
      seq: 4,
      data: { model: "requested" },
    },
    103,
  );
  output.send(tracker.shutdown(104));
  await output.flush();
  const [child, model, turn] = exporter.getFinishedSpans();
  expect(exporter.getFinishedSpans()).toHaveLength(3);
  for (const span of [child, model]) {
    expect(span?.spanContext().traceId).toBe(turn?.spanContext().traceId);
    expect(span?.parentSpanContext?.spanId).toBe(turn?.spanContext().spanId);
  }
  expect(child?.spanContext().spanId).not.toBe(model?.spanContext().spanId);
  expect(model?.status.code).toBe(SpanStatusCode.ERROR);
  expect(turn?.status.code).toBe(SpanStatusCode.ERROR);
  expect(turn?.parentSpanContext).toBeUndefined();
  expect(turn?.attributes["session.id"]).toBe("run");
  await output.shutdown();
});
