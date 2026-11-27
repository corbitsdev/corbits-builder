import { afterAll, beforeAll, expect, test } from "bun:test";
import JSZip from "jszip";
import { type } from "arktype";
import { createArtifact } from "@corbits/artifacts";
import { DOWNLOAD_NAME_BYTES } from "@corbits-builder/schemas/download-name";
import { readProjectImport } from "@corbits-builder/schemas/project-import";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

const bytes = (text: string) => new TextEncoder().encode(text).length;

// A person's whole first prompt, as a project's title takes it.
const PROMPT_TITLE =
  "I want to make a little release tracker for the entire team that is kind of like a blog, that shows a bento of new features, and then allows people to read them. A major inspiration is how Apple presents their releases. So it should feel sleek, minimalistic.";
const MULTI_BYTE_TITLE =
  "🚀 リリーストラッカー: チーム全員のための新機能のベントー、Café crème edition " +
  "✨".repeat(30) +
  ".";

// The name a download is saved under, as a browser reads it from the response.
function savedAs(response: Response) {
  const header = response.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
  return encoded === undefined
    ? /filename="([^"]*)"/.exec(header)![1]!
    : decodeURIComponent(encoded);
}

// Each name a system creates while unpacking the archive: every entry's every path component.
async function unpacked(response: Response) {
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  return { zip, entries: Object.keys(zip.files) };
}

// What macOS, Linux and Windows all create: at most 255 bytes, no reserved character, and not
// ending in a dot or space.
function expectExtractable(name: string) {
  expect(bytes(name)).toBeLessThanOrEqual(255);
  expect(name).not.toMatch(/[\\:*?"<>|\p{Cc}]/u);
  expect(name).not.toMatch(/[.\s]$/);
}

for (const title of [PROMPT_TITLE, MULTI_BYTE_TITLE])
  test(`the app's download of a project titled ${JSON.stringify(title.slice(0, 24))}… unpacks under one short directory`, async () => {
    const { path } = await hub.seedProject(title);
    await hub.seedApp(path, {
      "package.json": "{}",
      "src/index.ts": "export {};",
    });

    const response = await hub.call("GET", `${path}/app/archive`);
    const filename = savedAs(response);
    const { zip, entries } = await unpacked(response);
    const tops = new Set(entries.map((entry) => entry.split("/")[0]!));

    expect(tops.size).toBe(1);
    const [top] = [...tops];
    expect(bytes(top!)).toBeLessThanOrEqual(DOWNLOAD_NAME_BYTES);
    expect(filename).toStartWith(`${top!}-`);
    expect(filename).toEndWith(".zip");
    for (const name of [
      filename,
      ...entries.flatMap((entry) => entry.split("/")),
    ])
      if (name !== "") expectExtractable(name);
    expect(await zip.file(`${top!}/src/index.ts`)?.async("string")).toBe(
      "export {};",
    );
  });

test("a project's export with a whole prompt for a title unpacks, and its project.json still imports with the full title", async () => {
  const { path, person } = await hub.seedProject(MULTI_BYTE_TITLE);
  await hub.seedApp(path, { "package.json": "{}" });
  const seed = (kind: string, title: string, content: string) =>
    hub.db.transaction((tx) =>
      createArtifact(tx, {
        scope: person,
        ownerPrincipalId: person.principalId,
        kind,
        title,
        content,
        source: { origin: "manual" },
      }),
    );
  // Material titles are a file's name or, from an imported project, a document's whole title.
  const longMaterial = `${PROMPT_TITLE} Notes.md`;
  await seed("material", longMaterial, "first");
  await seed("material", `${PROMPT_TITLE} Notes, again.md`, "second");
  await seed("material", "brand guide.pdf", "third");
  const design = JSON.stringify({
    files: { "DESIGN.md": "# Option A", "designs/index.html": "<p>A</p>" },
  });
  await seed(
    "design_option",
    "Option A: calm / sleek… " + "✨".repeat(40),
    design,
  );

  const response = await hub.call("GET", `${path}/export/archive`);
  const filename = savedAs(response);
  const { zip, entries } = await unpacked(response);

  expect(bytes(filename)).toBeLessThanOrEqual(
    DOWNLOAD_NAME_BYTES + ".zip".length,
  );
  for (const name of [
    filename,
    ...entries.flatMap((entry) => entry.split("/")),
  ])
    if (name !== "") expectExtractable(name);
  expect(new Set(entries.map((entry) => entry.split("/")[0]))).toEqual(
    new Set(["project.json", "planning", "design", "build"]),
  );

  const materials = entries.filter(
    (entry) => entry.startsWith("planning/materials/") && !entry.endsWith("/"),
  );
  expect(materials).toHaveLength(3);
  expect(materials).toContain("planning/materials/brand-guide.pdf");
  expect(materials.filter((entry) => entry.endsWith(".md"))).toHaveLength(2);
  expect(
    entries.some(
      (entry) =>
        entry.startsWith("design/options/") &&
        entry.endsWith("/designs/index.html"),
    ),
  ).toBe(true);
  expect(await zip.file("build/package.json")?.async("string")).toBe("{}");

  const imported = readProjectImport(
    JSON.parse(await zip.file("project.json")!.async("string")),
  );
  if (imported instanceof type.errors) throw new Error(imported.summary);
  expect(imported.file.title).toBe(MULTI_BYTE_TITLE);
});
