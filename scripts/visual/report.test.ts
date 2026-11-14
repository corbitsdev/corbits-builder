import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  compare,
  html,
  markdown,
  pairCaptures,
  type Report,
} from "./report.ts";

function png(red: number, width = 20) {
  const image = new PNG({ width, height: 20 });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = red;
    image.data[i + 3] = 255;
  }
  return PNG.sync.write(image);
}

test("identical pixels are unchanged and a color change produces highlighted pixels", () => {
  expect(compare(png(0), png(0)).pixels).toBe(0);
  const result = compare(png(0), png(255));
  expect(result.pixels).toBe(400);
  const diff = PNG.sync.read(result.image);
  expect([...diff.data.subarray(0, 4)]).toEqual([255, 0, 80, 255]);
  expect(compare(png(0), png(0, 30)).pixels).toBeGreaterThan(0);
});

test("stable IDs pair captures and added/removed stories stay explicit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visual-report-"));
  try {
    await Bun.write(join(directory, "before.png"), png(0));
    await Bun.write(join(directory, "after.png"), png(255));
    const pairs = await pairCaptures(
      directory,
      [
        { id: "kept", variant: "desktop-light", file: "before.png" },
        { id: "removed", variant: "desktop-light", file: "before.png" },
      ],
      [
        { id: "added", variant: "desktop-light", file: "after.png" },
        { id: "kept", variant: "desktop-light", file: "after.png" },
      ],
    );
    expect(pairs.map((pair) => [pair.id, pair.status])).toEqual([
      ["added", "added"],
      ["kept", "changed"],
      ["removed", "removed"],
    ]);
    expect(
      await Bun.file(join(directory, "diff/kept-desktop-light.png")).exists(),
    ).toBe(true);
    const report: Report = {
      base: "a".repeat(40),
      head: "b".repeat(40),
      seconds: 1,
      browser: "156",
      pairs,
    };
    expect(markdown(report)).toContain("1 changed, 1 added, 1 removed");
    expect(html(report)).toContain('src="diff/kept-desktop-light.png"');
    expect(html(report)).toContain(report.base);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
