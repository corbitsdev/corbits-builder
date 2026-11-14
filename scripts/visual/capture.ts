import { chromium, expect, type Browser } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import {
  compare,
  html,
  markdown,
  pairCaptures,
  variants,
  type Capture,
  type Report,
} from "./report.ts";

type Entry = { id: string; type: string; tags?: string[] };
type Index = { v: number; entries: Record<string, Entry> };

export function serve(directory: string) {
  const root = resolve(directory);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = resolve(
        root,
        `.${decodeURIComponent(new URL(request.url).pathname)}`,
      );
      if (!path.startsWith(`${root}${sep}`))
        return new Response("Not found", { status: 404 });
      const file = Bun.file(path);
      if (!(await file.exists()))
        return new Response("Not found", { status: 404 });
      return new Response(file);
    },
  });
}

export async function capture(
  browser: Browser,
  origin: string,
  id: string,
  variant: (typeof variants)[number],
  path: string,
) {
  const context = await browser.newContext({
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 1,
    colorScheme: variant.mode,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    serviceWorkers: "block",
  });
  const errors: string[] = [];
  try {
    const page = await context.newPage();
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ["data:", "blob:"].includes(url.protocol))
        await route.continue();
      else {
        errors.push(`External request: ${url.origin}${url.pathname}`);
        await route.abort();
      }
    });
    await page.clock.setFixedTime(new Date("2026-11-10T12:00:00.000Z"));
    await page.addInitScript(() => {
      let seed = 42;
      Math.random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
    });
    await page.goto(
      `${origin}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=mode:${variant.mode}`,
      { waitUntil: "load" },
    );
    // Storybook 11 exposes the render phase; "finished" follows loaders, rendering and play.
    await page.waitForFunction(
      () => {
        const preview = (
          globalThis as typeof globalThis & {
            __STORYBOOK_PREVIEW__?: { currentRender?: { phase: string } };
          }
        ).__STORYBOOK_PREVIEW__;
        return preview?.currentRender?.phase === "finished";
      },
      undefined,
      { timeout: 15000 },
    );
    await expect(page.locator("body")).toHaveClass(/sb-show-main/);
    await expect(page.locator("#storybook-root")).not.toBeEmpty();
    await expect(page.locator("#storybook-root")).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      variant.mode === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
    );
    await page.evaluate(async () => {
      const { document } = globalThis as typeof globalThis & {
        document: {
          fonts: Iterable<{ status: string }> & { ready: Promise<unknown> };
          images: Iterable<{ src: string; decode(): Promise<void> }>;
        };
      };
      await document.fonts.ready;
      if ([...document.fonts].some((font) => font.status === "error"))
        throw new Error("Font loading failed");
      await Promise.all(
        [...document.images].map(async (image) => {
          if (image.src) await image.decode();
        }),
      );
    });
    // Two matching frames catch delayed layout and avoid arbitrary settling sleeps.
    let previous: Buffer | undefined;
    await expect
      .poll(
        async () => {
          const current = await page.screenshot({
            fullPage: true,
            animations: "disabled",
            caret: "hide",
          });
          const stable =
            previous !== undefined && compare(previous, current).pixels === 0;
          previous = current;
          return stable;
        },
        { timeout: 10000, intervals: [100, 200, 400] },
      )
      .toBe(true);
    if (errors.length) throw new Error(errors.join("\n"));
    if (!previous) throw new Error("No screenshot produced");
    await Bun.write(path, previous);
  } catch (error) {
    throw new Error(
      `Capture failed: ${id} / ${variant.name}: ${errors.join("; ")}`,
      { cause: error },
    );
  } finally {
    await context.close();
  }
}

export async function run(
  baseDirectory: string,
  headDirectory: string,
  output: string,
  base: string,
  head: string,
) {
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha)))
    throw new Error("Both full commit SHAs are required");
  const started = performance.now();
  const beforeServer = serve(baseDirectory);
  const afterServer = serve(headDirectory);
  const browser = await chromium.launch();
  try {
    const indexes: Index[] = await Promise.all(
      [baseDirectory, headDirectory].map(
        async (directory) =>
          await Bun.file(join(directory, "index.json")).json(),
      ),
    );
    if (indexes.some((index) => index.v !== 5))
      throw new Error("Unsupported Storybook index version");
    const ids = [
      ...new Set(
        indexes.flatMap((index) =>
          Object.values(index.entries)
            .filter(
              (entry) =>
                entry.type === "story" && entry.tags?.includes("visual"),
            )
            .map((entry) => entry.id),
        ),
      ),
    ].sort();
    if (!ids.length) throw new Error("No visual stories registered");
    if (ids.some((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id)))
      throw new Error("Unsafe story ID");
    const captures: Capture[][] = [];
    for (const [position, revision] of ["before", "after"].entries()) {
      const index = indexes[position];
      if (!index) throw new Error("Missing index");
      const origin = (position === 0 ? beforeServer : afterServer).url.origin;
      const items: Capture[] = [];
      await mkdir(join(output, revision), { recursive: true });
      for (const id of ids) {
        if (index.entries[id]?.type !== "story") continue;
        for (const variant of variants) {
          const file = `${revision}/${id}-${variant.name}.png`;
          console.log(`${revision}: ${id} / ${variant.name}`);
          await capture(browser, origin, id, variant, join(output, file));
          items.push({ id, variant: variant.name, file });
        }
      }
      captures.push(items);
    }
    const [before, after] = captures;
    if (!before || !after) throw new Error("Missing revision captures");
    const pairs = await pairCaptures(output, before, after);
    const report: Report = {
      base,
      head,
      seconds: (performance.now() - started) / 1000,
      browser: browser.version(),
      pairs,
    };
    await Bun.write(
      join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    await Bun.write(join(output, "README.md"), markdown(report));
    await Bun.write(join(output, "index.html"), html(report));
    console.log(
      `Captured ${pairs.length} pairs in ${report.seconds.toFixed(1)} seconds`,
    );
    return report;
  } finally {
    await browser.close();
    await beforeServer.stop(true);
    await afterServer.stop(true);
  }
}

if (import.meta.main) {
  const [baseDirectory, headDirectory, output, base, head] =
    process.argv.slice(2);
  if (!baseDirectory || !headDirectory || !output || !base || !head)
    throw new Error(
      "Usage: bun scripts/visual/capture.ts BASE_STORYBOOK HEAD_STORYBOOK OUTPUT BASE_SHA HEAD_SHA",
    );
  await run(baseDirectory, headDirectory, output, base, head);
}
