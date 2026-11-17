import { type } from "arktype";
import { parseInferenceEvent } from "@intx/types/runtime";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS,
  ATTR_SESSION_ID,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_GEN_AI_TOOL_CALL_ID,
  ATTR_GEN_AI_OUTPUT_MESSAGES,
  ATTR_GEN_AI_TOOL_CALL_ARGUMENTS,
  ATTR_GEN_AI_TOOL_CALL_RESULT,
} from "@opentelemetry/semantic-conventions/incubating";

export type RunContext = {
  tenantId?: string | undefined;
  projectId?: string | undefined;
  role?: string | undefined;
  effort?: string | undefined;
  profile?: string | undefined;
  packageVersion?: string | undefined;
};

function agentAttributes(
  address: string,
  runId: string,
  context: RunContext,
): FinishedSpan["attributes"] {
  const attributes: FinishedSpan["attributes"] = {
    "corbits.run.id": runId,
    "corbits.agent.address": address,
  };
  if (context.tenantId !== undefined)
    attributes["corbits.tenant.id"] = context.tenantId;
  if (context.projectId !== undefined) {
    attributes[ATTR_SESSION_ID] = context.projectId;
    attributes["corbits.project.id"] = context.projectId;
  }
  if (context.role !== undefined)
    attributes["corbits.agent.role"] = context.role;
  if (context.effort !== undefined)
    attributes["corbits.model.effort"] = context.effort;
  if (context.profile !== undefined)
    attributes["corbits.model.profile"] = context.profile;
  if (context.packageVersion !== undefined)
    attributes["corbits.agent.package.version"] = context.packageVersion;
  return attributes;
}

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

const MAX_SPANS = 1000;

function finish(span: FinishedSpan, at: number, error: string): FinishedSpan {
  span.endTime = at;
  span.error = error;
  return span;
}

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
  const close = (
    address: string,
    at: number,
    error?: string,
  ): FinishedSpan[] => {
    const state = agents.get(address);
    if (!state) return [];
    agents.delete(address);
    const spans: FinishedSpan[] = [];
    for (const span of state.open.values())
      spans.push(finish(span, at, error ?? "Turn ended before work completed"));
    state.turn.endTime = at;
    if (error !== undefined) state.turn.error = error;
    else if (spans.length > 0)
      state.turn.error = "Turn ended before work completed";
    spans.push(state.turn);
    return spans;
  };
  return {
    shutdown(at: number): FinishedSpan[] {
      const spans: FinishedSpan[] = [];
      for (const address of agents.keys())
        spans.push(
          ...close(address, at, "Hub shut down before turn completed"),
        );
      return spans;
    },
    accept(
      address: string,
      runId: string,
      context: RunContext,
      raw: unknown,
      at: number,
    ): FinishedSpan[] {
      const event = parseInferenceEvent(raw);
      if (event instanceof type.errors) return [];
      if (event.type === "message.run.started") {
        const spans = close(address, at, "Turn replaced before completion");
        agents.set(address, {
          turn: {
            traceKey: event.data.messageRunId,
            name: "agent turn",
            kind: "turn",
            key: "turn",
            startTime: at,
            endTime: at,
            attributes: agentAttributes(address, runId, context),
          },
          open: new Map(),
          idleSince: at,
        });
        if (agents.size > MAX_SPANS) {
          const oldest = agents.keys().next().value;
          if (oldest !== undefined)
            spans.push(...close(oldest, at, "Turn evicted before completion"));
        }
        return spans;
      }
      const state = agents.get(address);
      if (!state) return [];
      if (event.type === "message.run.ended") {
        if (event.data.messageRunId !== state.turn.traceKey) return [];
        let error: string | undefined;
        if (event.data.status === "failed")
          error = event.data.error?.message ?? event.data.status;
        return close(address, at, error);
      }
      let opened: FinishedSpan | undefined;
      switch (event.type) {
        case "inference.start":
          opened = {
            traceKey: state.turn.traceKey,
            name: `chat ${event.data.model}`,
            kind: "model",
            key: `model:${event.seq}`,
            parentKey: state.turn.key,
            startTime: state.idleSince,
            endTime: at,
            attributes: agentAttributes(address, runId, context),
          };
          opened.attributes[ATTR_GEN_AI_OPERATION_NAME] = "chat";
          opened.attributes[ATTR_GEN_AI_REQUEST_MODEL] = event.data.model;
          break;
        case "tool.start":
          opened = {
            traceKey: state.turn.traceKey,
            name: `execute_tool ${event.data.call.name}`,
            kind: "tool",
            key: `tool:${event.data.call.id}`,
            parentKey: state.turn.key,
            startTime: at,
            endTime: at,
            attributes: agentAttributes(address, runId, context),
          };
          opened.attributes[ATTR_GEN_AI_OPERATION_NAME] = "execute_tool";
          opened.attributes[ATTR_GEN_AI_TOOL_NAME] = event.data.call.name;
          opened.attributes[ATTR_GEN_AI_TOOL_CALL_ID] = event.data.call.id;
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
            // Interchange counts cached tokens apart from input; the convention counts them in it.
            let inputTokens = event.data.usage.input;
            if (event.data.usage.cacheRead !== undefined) {
              inputTokens += event.data.usage.cacheRead;
              model.attributes[ATTR_GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS] =
                event.data.usage.cacheRead;
            }
            if (event.data.usage.cacheWrite !== undefined) {
              inputTokens += event.data.usage.cacheWrite;
              model.attributes[ATTR_GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS] =
                event.data.usage.cacheWrite;
            }
            model.attributes[ATTR_GEN_AI_USAGE_INPUT_TOKENS] = inputTokens;
            model.attributes[ATTR_GEN_AI_USAGE_OUTPUT_TOKENS] =
              event.data.usage.output;
            if (options.captureContent)
              model.attributes[ATTR_GEN_AI_OUTPUT_MESSAGES] = JSON.stringify([
                {
                  role: "assistant",
                  parts: event.data.turn.content.flatMap(
                    (block): Record<string, unknown>[] => {
                      switch (block.type) {
                        case "text":
                          return [{ type: "text", content: block.text }];
                        case "thinking":
                          return [
                            { type: "reasoning", content: block.thinking },
                          ];
                        case "tool_call":
                          return [
                            {
                              type: "tool_call",
                              id: block.id,
                              name: block.name,
                              arguments: block.arguments,
                            },
                          ];
                        default:
                          return [];
                      }
                    },
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
      if (opened) state.open.set(opened.key, opened);
      return [];
    },
  };
}
