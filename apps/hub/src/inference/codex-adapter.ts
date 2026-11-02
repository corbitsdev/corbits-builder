import {
  createCodexResponsesAdapter as createProviderCodexResponsesAdapter,
  withCodexContentTypeRepair,
} from "@corbits/codex-provider";
import type { AdapterFactory } from "@intx/inference";

// `@corbits/codex-provider` hardcodes `parallel_tool_calls: false`, which
// forces the model to serialize independent tool calls across turns.
export const createCodexResponsesAdapter: AdapterFactory = (source, quirks) => {
  const adapter = createProviderCodexResponsesAdapter(source, quirks);
  return {
    ...adapter,
    buildRequest: (messages, model, options) => {
      const request = adapter.buildRequest(messages, model, options);
      const body = JSON.parse(request.body) as Record<string, unknown>;
      return {
        ...request,
        body: JSON.stringify({
          ...body,
          parallel_tool_calls: true,
        }),
      };
    },
  };
};

// The Codex backend omits Content-Type on some response streams, and the inference harness rejects a response
// without one. A sidecar builds its harness on the global fetch after importing this adapter, so the repair is
// installed there; it only touches successful Codex responses that arrive without a Content-Type.
globalThis.fetch = Object.assign(withCodexContentTypeRepair(globalThis.fetch), {
  preconnect: globalThis.fetch.preconnect,
});
