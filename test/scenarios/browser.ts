/**
 * The real web app for a browser scenario: its dev server proxying a test hub, the person signed in,
 * and what the browser logged and asked the hub on the way.
 */
import { join } from "node:path";
import type { Page } from "@playwright/test";

const WEB_DIR = join(import.meta.dir, "..", "..", "apps", "web");
// The account startTestHub signs up.
const PERSON = { email: "e2e@corbits.dev", password: "e2e-password-123456" };

export async function startWebApp(hubOrigin: string, port: number) {
  const web = Bun.spawn(
    [
      join(WEB_DIR, "node_modules", ".bin", "vite"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: WEB_DIR,
      env: {
        PATH: process.env["PATH"],
        HOME: process.env["HOME"],
        UI_HUB_ORIGIN: hubOrigin,
        UI_PORT: String(port),
      },
      stdout: "ignore",
      stderr: "inherit",
    },
  );
  console.log(`web app dev server pid ${String(web.pid)}`);
  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (web.exitCode !== null)
      throw new Error(`The web app exited with ${String(web.exitCode)}`);
    try {
      if ((await fetch(url)).ok) return { web, url };
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(500);
  }
  web.kill();
  throw new Error(`The web app did not answer on ${url}`);
}

/** The browser's console and its hub calls, with the bodies of the calls that match `read`. */
export function watchPage(page: Page, read: RegExp) {
  const consoleLines: string[] = [];
  const network: Record<string, unknown>[] = [];
  page.on("console", (message) =>
    consoleLines.push(`${message.type()}: ${message.text()}`),
  );
  page.on("pageerror", (error) =>
    consoleLines.push(`pageerror: ${error.message}`),
  );
  page.on("requestfailed", (request) =>
    network.push({
      method: request.method(),
      url: request.url(),
      failure: request.failure()?.errorText,
    }),
  );
  page.on("response", async (response) => {
    const request = response.request();
    if (!request.url().includes("/api/")) return;
    const entry: Record<string, unknown> = {
      method: request.method(),
      url: request.url(),
      status: response.status(),
      sent: request.postData(),
    };
    network.push(entry);
    // Streams never finish, so only the calls the flow makes are read.
    if (read.test(request.url()))
      try {
        entry["received"] = await response.text();
      } catch (error) {
        // A response the page navigated away from has no body left to read.
        entry["unreadable"] = String(error);
      }
  });
  return { consoleLines, network };
}

export async function signIn(page: Page, url: string) {
  await page.goto(url);
  await page.locator('input[name="email"]').fill(PERSON.email);
  await page.locator('input[name="password"]').fill(PERSON.password);
  await page.locator('input[name="password"]').press("Enter");
  await page.waitForLoadState("networkidle");
}
