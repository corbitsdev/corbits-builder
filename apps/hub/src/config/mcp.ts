import type { McpToolsOptions } from "@corbits/mcp/interchange/client";

// The browser reaches only loopback, where the coder's own dev app runs on a port the sandbox picks;
// Playwright aborts every other request, which is what lets its page tools run without asking.
// Playwright's MCP server runs inside the coder's own sandbox, so run_code_unsafe's code and the
// files file_upload and drop read by path are confined as the coder's run_shell is.
export const BROWSER_ALLOWED_ORIGINS = ["http://127.0.0.1:*"];
export const BROWSER_TOOLS = [
  "navigate",
  "navigate_back",
  "tabs",
  "close",
  "snapshot",
  "find",
  "click",
  "type",
  "fill_form",
  "select_option",
  "press_key",
  "hover",
  "drag",
  "handle_dialog",
  "evaluate",
  "emulate_media",
  "wait_for",
  "resize",
  "console_messages",
  "network_requests",
  "network_request",
  "take_screenshot",
  "run_code_unsafe",
  "file_upload",
  "drop",
].map((tool) => `browser.browser_${tool}`);

// Remote MCP servers the coder calls from its own deployment. Exa answers keyless, so no credential
// handle. Only its read-only tools run without a person's approval.
export const CODER_MCP: McpToolsOptions = {
  servers: [{ name: "exa", url: "https://mcp.exa.ai/mcp" }],
  allowWithoutAsk: ["exa.web_search_exa", "exa.web_fetch_exa"],
};
