import type { ToolDeclaration } from "@intx/agent/authoring";
import type { ToolDefinition } from "@intx/types/runtime";
import { BROWSER_ARGS, browserTools } from "./browser.ts";
import { browserCli } from "./package-layout.ts";

export type BrowserCatalog = {
  definitions: ToolDeclaration[];
  tools: ToolDefinition[];
};

/**
 * A macro: the coder's browser tools, listed by Playwright's MCP server when the bundle is built,
 * so the frozen definition names them before any deployment has started its own browser. Listing
 * tools opens no browser.
 */
export async function browserCatalog(): Promise<BrowserCatalog> {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  await probe.stop(true);
  const child = Bun.spawn(
    [process.execPath, browserCli(), ...BROWSER_ARGS, "--port", String(port)],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  try {
    const url = `http://127.0.0.1:${port}/mcp`;
    const deadline = Date.now() + 30_000;
    while (
      !(await fetch(url).then(
        () => true,
        () => false,
      ))
    ) {
      if (child.exitCode !== null)
        throw new Error(`browser_mcp_exited:${child.exitCode}`);
      if (Date.now() > deadline) throw new Error("browser_mcp_unavailable");
      await Bun.sleep(250);
    }
    const factory = await browserTools(url);
    return {
      definitions: [...factory.definitions],
      tools: [...factory({} as Parameters<typeof factory>[0]).definitions],
    };
  } finally {
    child.kill();
    await child.exited;
  }
}
