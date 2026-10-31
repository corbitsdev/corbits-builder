import { withCodexContentTypeRepair } from "@corbits/codex-provider";

export { createCodexResponsesAdapter } from "@corbits/codex-provider";

// The Codex backend omits Content-Type on some response streams, and the inference harness rejects a response
// without one. A sidecar builds its harness on the global fetch after importing this adapter, so the repair is
// installed there; it only touches successful Codex responses that arrive without a Content-Type.
globalThis.fetch = Object.assign(withCodexContentTypeRepair(globalThis.fetch), {
  preconnect: globalThis.fetch.preconnect,
});
