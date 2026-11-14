import { expect } from "bun:test";
import { chromium } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { capture, run, serve } from "./capture.ts";
import { variants } from "./report.ts";

// Exercise the real built stories; mutations stay in disposable build copies.
const input = process.argv[2];
if (!input)
  throw new Error(
    "Usage: bun scripts/visual/verify-browser.ts STORYBOOK_DIRECTORY",
  );
const directory = await mkdtemp(join(tmpdir(), "builder-visual-browser-"));
const sha = "a".repeat(40);
try {
  const unchanged = await run(
    input,
    input,
    join(directory, "identical"),
    sha,
    sha,
  );
  expect(unchanged.pairs.every((pair) => pair.status === "unchanged")).toBe(
    true,
  );
  const base = join(directory, "base");
  const head = join(directory, "head");
  await cp(resolve(input), base, { recursive: true });
  await cp(resolve(input), head, { recursive: true });
  const before = await Bun.file(join(base, "index.json")).json();
  const after = await Bun.file(join(head, "index.json")).json();
  delete before.entries["screens-signin--sign-up"];
  delete after.entries["screens-signin--sign-in"];
  await Bun.write(join(base, "index.json"), JSON.stringify(before));
  await Bun.write(join(head, "index.json"), JSON.stringify(after));
  const iframe = await Bun.file(join(head, "iframe.html")).text();
  await Bun.write(
    join(head, "iframe.html"),
    iframe.replace(
      "</head>",
      "<style>body { border: 12px solid red !important; box-sizing: border-box }</style></head>",
    ),
  );
  const changed = await run(
    base,
    head,
    join(directory, "changed"),
    sha,
    "b".repeat(40),
  );
  expect(changed.pairs.filter((pair) => pair.status === "added")).toHaveLength(
    4,
  );
  expect(
    changed.pairs.filter((pair) => pair.status === "removed"),
  ).toHaveLength(4);
  expect(
    changed.pairs.filter((pair) => pair.status === "changed"),
  ).toHaveLength(4);
  expect(
    changed.pairs
      .filter((pair) => pair.status === "changed")
      .every((pair) => pair.pixels > 0 && pair.diff !== null),
  ).toBe(true);
  const server = serve(head);
  const browser = await chromium.launch();
  try {
    await Bun.write(
      join(head, "iframe.html"),
      iframe.replace(
        "</head>",
        '<script>throw new Error("Intentional rendering failure")</script></head>',
      ),
    );
    await expect(
      capture(
        browser,
        server.url.origin,
        "screens-projects-library--tiles",
        variants[0],
        join(directory, "broken.png"),
      ),
    ).rejects.toThrow("Intentional rendering failure");
    await Bun.write(
      join(head, "iframe.html"),
      iframe.replace(
        "</head>",
        "<style>#storybook-root { display: none !important }</style></head>",
      ),
    );
    await expect(
      capture(
        browser,
        server.url.origin,
        "screens-projects-library--tiles",
        variants[0],
        join(directory, "blank.png"),
      ),
    ).rejects.toThrow("Capture failed");
  } finally {
    await browser.close();
    await server.stop(true);
  }
  const output = process.argv[3];
  if (output) await cp(join(directory, "changed"), output, { recursive: true });
  console.log(
    `Browser validation passed: unchanged ${unchanged.seconds.toFixed(1)}s; changed/added/removed ${changed.seconds.toFixed(1)}s; errors and blank rendering rejected.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
