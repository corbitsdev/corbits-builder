import { createOpenAIResponsesAdapter as createProviderOpenAIResponsesAdapter } from "@corbits/openai-responses";
import type { AdapterFactory } from "@intx/inference";

// OpenAI treats a function tool without `strict` as strict, which makes every property required, so
// the model filled optional fields with made-up values ("dummy", " ") and the calls failed. A
// non-strict tool gives up OpenAI's promise that arguments match the schema; every tool checks its
// own arguments, so a bad call fails and is retried instead.
export const createOpenAIResponsesAdapter: AdapterFactory = (
  source,
  quirks,
) => {
  const adapter = createProviderOpenAIResponsesAdapter(source, quirks);
  return {
    ...adapter,
    buildRequest: (messages, model, options) => {
      const request = adapter.buildRequest(messages, model, options);
      const body = JSON.parse(request.body) as { tools?: unknown };
      if (!Array.isArray(body.tools)) return request;
      return {
        ...request,
        body: JSON.stringify({
          ...body,
          tools: body.tools.map((tool: Record<string, unknown>) => ({
            ...tool,
            strict: false,
          })),
        }),
      };
    },
  };
};
