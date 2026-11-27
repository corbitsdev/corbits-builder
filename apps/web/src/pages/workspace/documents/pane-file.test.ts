import { expect, test } from "bun:test";
import JSZip from "jszip";
import { DOWNLOAD_NAME_BYTES } from "@corbits-builder/schemas/download-name";
import { fileStem, zipFile } from "./pane-file.ts";

const bytes = (text: string) => new TextEncoder().encode(text).length;

const PROMPT_TITLE =
  "I want to make a little release tracker for the entire team that is kind of like a blog, that shows a bento of new features, and then allows people to read them. A major inspiration is how Apple presents their releases. So it should feel sleek, minimalistic.";

test("a document's file keeps its name and version whole and shortens the project's title", () => {
  expect(fileStem(PROMPT_TITLE, "Problem brief", "v12")).toBe(
    "I-want-to-make-a-little-release-tracker-for-Problem-brief-v12",
  );
  expect(fileStem("Acme Portal", "Problem brief", "v3")).toBe(
    "Acme-Portal-Problem-brief-v3",
  );
});

test("a design's zip unpacks under one short directory with no trailing dot", async () => {
  const stem = fileStem(
    "🚀 Launch notes, sleek and minimal… " + "✨".repeat(40) + ".",
    "Design",
    "v2",
  );
  const file = await zipFile(stem, {
    "index.html": "<p>Hi</p>",
    "css/site.css": "p{}",
  });
  const entries = Object.keys(
    (await JSZip.loadAsync(await file.arrayBuffer())).files,
  );

  expect(stem).toEndWith("-Design-v2");
  expect(bytes(stem)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
  for (const entry of entries) {
    const [top] = entry.split("/");
    expect(top).toBe(stem);
    expect(top).not.toMatch(/[.\s]$/);
  }
});
