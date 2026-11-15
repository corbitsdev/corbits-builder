import { type } from "arktype";
import { parseInferenceEvent } from "@intx/types/runtime";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_OUTPUT_MESSAGES,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
} from "@opentelemetry/semantic-conventions/incubating";

export type FinishedSpan = {
  traceKey: string;
  name: string;
  kind: "turn" | "model" | "tool";
  parentKey?: string;
  key: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, string | number | boolean>;
  error?: string;
};

export function createRunSpans(options: { captureContent: boolean }) {
  const agents = new Map<
    string,
    {
      turn: FinishedSpan;
      open: Map<string, FinishedSpan>;
      // When the turn's last step ended. Interchange holds a model call's events until the call
      // returns, so its start event arrives at the end; the call really began when the step before it
      // finished.
      idleSince: number;
    }
  >();
  return {
    accept(
      agent: { address: string; runId: string },
      raw: unknown,
      at: number,
    ): FinishedSpan[] {
      const event = parseInferenceEvent(raw);
      if (event instanceof type.errors) return [];
      if (event.type === "message.run.started") {
        agents.delete(agent.address);
        agents.set(agent.address, {
          turn: {
            traceKey: event.data.messageRunId,
            name: "agent turn",
            kind: "turn",
            key: "turn",
            startTime: at,
            endTime: at,
            attributes: {
              "corbits.run.id": agent.runId,
              "corbits.agent.address": agent.address,
            },
          },
          open: new Map(),
          idleSince: at,
        });
        if (agents.size > 1000) {
          const oldest = agents.keys().next().value;
          if (oldest !== undefined) agents.delete(oldest);
        }
        return [];
      }
      const state = agents.get(agent.address);
      if (!state) return [];
      if (event.type === "message.run.ended") {
        if (event.data.messageRunId !== state.turn.traceKey) return [];
        agents.delete(agent.address);
        state.turn.endTime = at;
        if (event.data.status === "failed")
          state.turn.error = event.data.error?.message ?? event.data.status;
        return [state.turn];
      }
      let opened: FinishedSpan | undefined;
      switch (event.type) {
        case "inference.start":
          opened = {
            ...state.turn,
            name: `chat ${event.data.model}`,
            kind: "model",
            key: `model:${event.seq}`,
            parentKey: state.turn.key,
            startTime: state.idleSince,
            endTime: at,
            attributes: {
              ...state.turn.attributes,
              [ATTR_GEN_AI_OPERATION_NAME]: "chat",
              [ATTR_GEN_AI_REQUEST_MODEL]: event.data.model,
            },
          };
          break;
        case "tool.start":
          opened = {
            ...state.turn,
            name: `execute_tool ${event.data.call.name}`,
            kind: "tool",
            key: `tool:${event.data.call.id}`,
            parentKey: state.turn.key,
            startTime: at,
            endTime: at,
            attributes: {
              ...state.turn.attributes,
              [ATTR_GEN_AI_OPERATION_NAME]: "execute_tool",
              [ATTR_GEN_AI_TOOL_NAME]: event.data.call.name,
              [ATTR_GEN_AI_TOOL_CALL_ID]: event.data.call.id,
            },
          };
          if (options.captureContent)
            opened.attributes[ATTR_GEN_AI_TOOL_CALL_ARGUMENTS] = JSON.stringify(
              event.data.call.arguments,
            );
          break;
        case "inference.done":
        case "inference.error": {
          const model = [...state.open.values()].find(
            (span) => span.kind === "model",
          );
          if (!model) return [];
          state.open.delete(model.key);
          model.endTime = at;
          state.idleSince = at;
          if (event.type === "inference.error")
            model.error = event.data.error.message;
          else {
            model.attributes[ATTR_GEN_AI_PROVIDER_NAME] =
              event.data.source.provider;
            model.attributes[ATTR_GEN_AI_RESPONSE_MODEL] =
              event.data.source.model;
            model.attributes[ATTR_GEN_AI_USAGE_INPUT_TOKENS] =
              event.data.usage.input;
            model.attributes[ATTR_GEN_AI_USAGE_OUTPUT_TOKENS] =
              event.data.usage.output;
            if (options.captureContent)
              model.attributes[ATTR_GEN_AI_OUTPUT_MESSAGES] = JSON.stringify([
                {
                  role: "assistant",
                  parts: event.data.turn.content.flatMap((block) =>
                    block.type === "text"
                      ? [{ type: "text", content: block.text }]
                      : [],
                  ),
                },
              ]);
          }
          return [model];
        }
        case "tool.done": {
          const tool = state.open.get(`tool:${event.data.result.callId}`);
          if (!tool) return [];
          state.open.delete(tool.key);
          tool.endTime = at;
          state.idleSince = at;
          if (event.data.result.isError) tool.error = "Tool execution failed";
          if (options.captureContent)
            tool.attributes[ATTR_GEN_AI_TOOL_CALL_RESULT] = JSON.stringify(
              event.data.result.content,
            );
          return [tool];
        }
      }
      if (opened) {
        state.open.set(opened.key, opened);
        // The turn itself occupies one of the 1000 open span slots.
        if (state.open.size > 999) {
          const oldest = state.open.keys().next().value;
          if (oldest !== undefined) state.open.delete(oldest);
        }
      }
      return [];
    },
  };
}
