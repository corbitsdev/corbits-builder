import {
  ProtocolMismatchError,
  type AdapterFactory,
  type ProviderAdapter,
} from "@intx/inference";
import { createOpenAIAdapter } from "@intx/inference/providers";
import { REPETITION_ABORT, repetitionWatch } from "./repetition.ts";

// Some OpenAI-compatible servers stream `delta.role: null` on continuation chunks. The stock chunk schema
// requires a string there and drops the whole chunk, so the role is removed before parsing.
function withoutNullRole(sseData: string): string {
  if (!sseData.includes('"role":null')) return sseData;
  let chunk: unknown;
  try {
    chunk = JSON.parse(sseData);
  } catch {
    return sseData;
  }
  if (chunk === null || typeof chunk !== "object" || !("choices" in chunk))
    return sseData;
  const { choices } = chunk;
  if (!Array.isArray(choices)) return sseData;
  for (const choice of choices) {
    const delta: unknown = choice?.delta;
    if (
      delta !== null &&
      typeof delta === "object" &&
      "role" in delta &&
      delta.role === null
    )
      delete delta.role;
  }
  return JSON.stringify(chunk);
}

// Custom endpoints speak chat completions, not the Responses API. The registry
// key is the settings allowlist id for those endpoints.
export const createOpenAICompatibleAdapter: AdapterFactory = (
  source,
  quirks,
): ProviderAdapter => {
  const adapter = createOpenAIAdapter(source, quirks);
  const watches = {
    "inference.text.delta": repetitionWatch(),
    "inference.thinking.delta": repetitionWatch(),
  };
  return {
    ...adapter,
    // providerOptions is the bag InferenceOptions says an adapter merges into the request body;
    // the stock OpenAI builder drops it. Chat completions report token usage on a stream only when
    // asked; without it the reactor's usage stays zero and the hub never compacts, so a
    // coordinator's history grew to about 220000 tokens of resent reasoning.
    buildRequest: (messages, model, options) => {
      const request = adapter.buildRequest(messages, model, options);
      const body = JSON.parse(request.body) as Record<string, unknown>;
      return {
        ...request,
        body: JSON.stringify({
          ...body,
          ...(body["stream"] === true
            ? { stream_options: { include_usage: true } }
            : {}),
          ...options.providerOptions,
        }),
      };
    },
    // ProtocolMismatchError is the one failure a response parser may raise (adapter.ts); the
    // harness ends the call with it as an inference.error the director sees.
    parseResponse: (sseData) => {
      const events = adapter.parseResponse(withoutNullRole(sseData));
      for (const event of events)
        if (
          (event.type === "inference.text.delta" ||
            event.type === "inference.thinking.delta") &&
          watches[event.type](event.data.token)
        )
          throw new ProtocolMismatchError(
            `${REPETITION_ABORT}: the ${event.type === "inference.text.delta" ? "reply" : "reasoning"} repeated one passage`,
          );
      return events;
    },
  };
};
