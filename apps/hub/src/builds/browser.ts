import { mcpTools } from "@corbits/mcp/interchange/client";
import { BROWSER_ALLOWED_ORIGINS, BROWSER_TOOLS } from "../config/mcp.ts";

// Playwright's MCP server confined to loopback, where the coder's own dev app runs.
export const BROWSER_ARGS = [
  "--headless",
  "--isolated",
  "--host",
  "127.0.0.1",
  "--allowed-origins",
  BROWSER_ALLOWED_ORIGINS.join(";"),
  "--allowed-hosts",
  "*",
  "--image-responses",
  "omit",
];

export const browserTools = (url: string) =>
  mcpTools({
    servers: [{ name: "browser", url, confined: true }],
    allowWithoutAsk: BROWSER_TOOLS,
  });
