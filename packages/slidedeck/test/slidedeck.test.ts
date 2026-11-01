import { expect, test } from "bun:test";

import { unzip } from "@corbits/zip";

import { validateDeck, writePptx } from "../src/index.ts";
import { assets, deck } from "./fixture.ts";

const XML_TOKEN =
  /<\?xml[^?]*\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+="[^"<]*")*)\s*(\/?)>|[^<]+/gy;
const BAD_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/;

/** The first well-formedness problem in a part, or undefined; enough to catch a writer slip. */
function xmlProblem(xml: string) {
  const open: string[] = [];
  let roots = 0;
  let at = 0;
  for (const [token, closing, name, attributes, selfClosing] of xml.matchAll(
    XML_TOKEN,
  )) {
    at += token.length;
    if (BAD_ENTITY.test(token)) return `bad entity before ${at}`;
    if (!name) {
      if (open.length === 0 && !token.startsWith("<?") && token.trim())
        return "text outside the root";
      continue;
    }
    if (closing) {
      if (attributes || selfClosing || open.pop() !== name)
        return `stray </${name}>`;
      continue;
    }
    if (open.length === 0) roots++;
    if (!selfClosing) open.push(name);
  }
  if (at !== xml.length) return `unreadable markup at ${at}`;
  if (open.length > 0) return `unclosed <${open.at(-1)}>`;
  return roots === 1 ? undefined : `${roots} root elements`;
}

test("the fixture deck writes the same bytes twice and every part reads back", async () => {
  const first = await writePptx(deck, assets);
  expect(await writePptx(deck, assets)).toEqual(first);

  const parts = await unzip(first);
  const paths = parts.map((part) => part.path);
  expect(paths[0]).toBe("[Content_Types].xml");
  expect(paths).toContain("ppt/media/image1.png");
  for (const index of [1, 3, 8])
    expect(paths).toContain(`ppt/notesSlides/notesSlide${index}.xml`);
  expect(
    paths.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  ).toHaveLength(8);
  const decoder = new TextDecoder();
  const contentTypes = decoder.decode(parts[0]?.data);
  for (const path of paths.filter(
    (path) => path.endsWith(".xml") && !path.startsWith("["),
  ))
    expect(contentTypes).toContain(`PartName="/${path}"`);

  for (const { path, data } of parts) {
    if (!/\.(xml|rels)$/.test(path)) continue;
    const xml = decoder.decode(data);
    expect({ path, problem: xmlProblem(xml) }).toEqual({
      path,
      problem: undefined,
    });
    if (!path.endsWith(".rels")) continue;
    const base = `file:///${path.replace(/_rels\/[^/]+$/, "")}`;
    for (const [, target = ""] of xml.matchAll(/Target="([^"]+)"/g))
      expect(paths).toContain(new URL(target, base).pathname.slice(1));
  }
});

test("an invalid deck names the slide and field", () => {
  const result = validateDeck({
    ...deck,
    slides: [deck.slides[0], { layout: "content", body: [] }],
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues).toEqual([
    expect.objectContaining({ slide: 1, path: "slides[1].title" }),
  ]);
});

test("the slide master's content placeholder is a typed body, which PowerPoint needs to open the deck", async () => {
  const parts = await unzip(await writePptx(deck, assets));
  const master = parts.find(
    (part) => part.path === "ppt/slideMasters/slideMaster1.xml",
  );
  const placeholders = new TextDecoder()
    .decode(master?.data)
    .match(/<p:ph [^>]*>/g);
  expect(placeholders).toContain('<p:ph type="body" idx="1"/>');
});
