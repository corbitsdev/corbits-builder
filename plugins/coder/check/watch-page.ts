// watch-page <url>: keeps the dev app's page open in the headless browser for the whole build and
// prints each error the page meets as one JSON line ({ "detail": string }). A "reload" line on stdin
// loads the page again once the files settle, so a change to the server shows on the page too.
import { homedir } from "node:os";
import { join } from "node:path";

type Cdp<T> = MessageEvent<T>;

const url = process.argv[2];
if (!url) throw new Error("watch-page <url>");
// Vite polls for edits every 300 ms and bun --watch restarts the server; reload after both.
const SETTLE_MS = 1_500;
const READY_MS = 30_000;

const origin = `${new URL(url).origin}/`;
// One line: the message without console format tokens, origin or Vite's cache-busting query, and
// the first frame of its stack.
const report = (detail: string) => {
  const [message = "", ...stack] = detail
    .replace(/%[sdifoOc]\s*/g, "")
    .replaceAll(origin, "")
    .replace(/\?[tv]=\w+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const frame = stack.find((line) => line.startsWith("at "));
  console.log(
    JSON.stringify({ detail: frame ? `${message} ${frame}` : message }),
  );
};
const describe = (value: unknown) => {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "description" in value)
    return String(value.description);
  return JSON.stringify(value);
};

// The sandbox setup unpacks Chrome's headless shell under $HOME/browsers. A sandboxed process may not
// register Mach services, so Chrome runs as one process with its own sandbox off.
const [chrome] = await Array.fromAsync(
  new Bun.Glob("chrome-headless-shell-*/chrome-headless-shell").scan({
    cwd: join(homedir(), "browsers"),
    absolute: true,
  }),
);
if (!chrome) process.exit(0);

const deadline = Date.now() + READY_MS;
while (
  !(await fetch(url).then(
    () => true,
    () => false,
  ))
) {
  if (Date.now() > deadline) process.exit(0);
  await Bun.sleep(250);
}

const view = new Bun.WebView({
  backend: {
    type: "chrome",
    path: chrome,
    argv: ["--single-process", "--no-zygote", "--no-sandbox"],
  },
  console: (type, ...args) => {
    if (type === "error")
      report(`console error: ${args.map(describe).join(" ")}`);
  },
});
await view.navigate(url);
await view.cdp("Network.enable");
await view.cdp("Log.enable");
view.addEventListener(
  "Runtime.exceptionThrown",
  (
    event: Cdp<{
      exceptionDetails: { text: string; exception?: { description?: string } };
    }>,
  ) =>
    report(
      `uncaught ${event.data.exceptionDetails.exception?.description ?? event.data.exceptionDetails.text}`,
    ),
);
view.addEventListener(
  "Log.entryAdded",
  (event: Cdp<{ entry: { level: string; source: string; text: string } }>) => {
    if (
      event.data.entry.level === "error" &&
      event.data.entry.source !== "network"
    )
      report(event.data.entry.text);
  },
);
view.addEventListener(
  "Network.responseReceived",
  (event: Cdp<{ response: { status: number; url: string } }>) => {
    const { status, url: requested } = event.data.response;
    if (status >= 400) report(`HTTP ${status} ${new URL(requested).pathname}`);
  },
);
view.addEventListener(
  "Network.loadingFailed",
  (event: Cdp<{ canceled?: boolean; errorText: string }>) => {
    if (!event.data.canceled) report(`request failed: ${event.data.errorText}`);
  },
);

let reloading: Timer | undefined;
for await (const chunk of Bun.stdin.stream())
  if (new TextDecoder().decode(chunk).includes("reload")) {
    clearTimeout(reloading);
    reloading = setTimeout(
      () => void view.navigate(url).catch(() => undefined),
      SETTLE_MS,
    );
  }
view.close();
