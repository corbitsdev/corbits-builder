import type { AdapterFactory } from "@intx/inference";
import { createAnthropicAdapter as createProviderAnthropicAdapter } from "@intx/inference/providers";
import { isTextLikeMimeType } from "@intx/types/attachments";
import { base64Decode } from "@intx/types/base64";
import { type } from "arktype";

const Base64Document = type({
  type: "'document'",
  source: { type: "'base64'", media_type: "string", data: "string" },
});

const Body = type({ messages: type({ content: "unknown[]" }).array() });

// Anthropic accepts a base64 document only as a PDF, so a text attachment is refused and, staying
// in the history, refuses every later turn. A plain-text source carries the decoded text instead,
// and `text/plain` is the only media type that source accepts. Bytes that are not UTF-8 arrive as
// replacement characters, which keeps the call valid. Delete this adapter, and its entry
// in the sidecar adapter manifest, once Interchange's Anthropic adapter sends text documents itself.
function asTextDocument(block: unknown): unknown {
  const document = Base64Document(block);
  if (document instanceof type.errors) return block;
  if (!isTextLikeMimeType(document.source.media_type)) return block;
  return {
    ...document,
    source: {
      type: "text",
      media_type: "text/plain",
      data: new TextDecoder().decode(base64Decode(document.source.data)),
    },
  };
}

export const createAnthropicAdapter: AdapterFactory = (source, quirks) => {
  const adapter = createProviderAnthropicAdapter(source, quirks);
  return {
    ...adapter,
    buildRequest: (messages, model, options) => {
      const request = adapter.buildRequest(messages, model, options);
      const body: unknown = JSON.parse(request.body);
      const parsed = Body(body);
      if (parsed instanceof type.errors) throw new Error(parsed.summary);
      return {
        ...request,
        body: JSON.stringify({
          ...parsed,
          messages: parsed.messages.map((message) => ({
            ...message,
            content: message.content.map(asTextDocument),
          })),
        }),
      };
    },
  };
};
