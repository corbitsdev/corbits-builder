import { expect, test } from "bun:test";
import { DOWNLOAD_NAME_BYTES, downloadName } from "./download-name.ts";

const bytes = (text: string) => new TextEncoder().encode(text).length;

// A person's whole first prompt, as a project's title takes it.
const PROMPT_TITLE =
  "I want to make a little release tracker for the entire team that is kind of like a blog, that shows a bento of new features, and then allows people to read them. A major inspiration is how Apple presents their releases. So it should feel sleek, minimalistic.";

test("a title that fits is kept, with its separators and reserved characters as hyphens", () => {
  expect(downloadName("Acme Portal")).toBe("Acme-Portal");
  expect(downloadName("Q3: plans/costs?")).toBe("Q3-plans-costs");
  expect(downloadName("../.hidden")).toBe("hidden");
  expect(downloadName("   ")).toBe("app");
  expect(downloadName("", [], "package")).toBe("package");
});

test("a long title is cut at a word to the byte limit and ends in neither a dot nor a hyphen", () => {
  const name = downloadName(PROMPT_TITLE);

  expect(name).toBe(
    "I-want-to-make-a-little-release-tracker-for-the-entire-team-that",
  );
  expect(bytes(name)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
});

test("a title ending in a dot or space loses it, since Windows cannot create such a name", () => {
  expect(downloadName("Sleek, minimalistic.")).toBe("Sleek,-minimalistic");
  expect(downloadName("Release notes. ")).toBe("Release-notes");
});

test("a multi-byte title is cut by bytes at whole characters", () => {
  const titles = [
    "リリーストラッカーはチーム全員のためのブログのようなもので、新機能をベントーで見せて、読めるようにします。",
    "🚀🎉✨".repeat(20) + ".",
    "Café crème brûlée für das gesamte Team, mit Übersicht über alle neuen Funktionen.",
    "👩‍👩‍👧‍👦".repeat(10),
  ];
  for (const title of titles) {
    const name = downloadName(title);
    expect(bytes(name)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
    expect(name).not.toMatch(/[.\s-]$/);
    expect(name).not.toContain("�");
    expect(title.replace(/\s+/g, "-")).toStartWith(name);
  }
  // A family emoji is one character of several code points, never split.
  expect(downloadName("👩‍👩‍👧‍👦".repeat(10))).toBe("👩‍👩‍👧‍👦".repeat(2));
});

test("the parts after the title stay whole and the title shrinks to make room for them", () => {
  const name = downloadName(PROMPT_TITLE, ["Problem brief", "v12"]);

  expect(name).toBe(
    "I-want-to-make-a-little-release-tracker-for-Problem-brief-v12",
  );
  expect(bytes(name)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
  expect(downloadName("Acme", ["Problem brief", "v3"])).toBe(
    "Acme-Problem-brief-v3",
  );
});

test("parts too long to keep whole are cut from the front, the last one kept longest", () => {
  const name = downloadName("Acme", ["word ".repeat(30), "v3"]);

  expect(name).toEndWith("-v3");
  expect(name).not.toContain("Acme");
  expect(bytes(name)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
});
