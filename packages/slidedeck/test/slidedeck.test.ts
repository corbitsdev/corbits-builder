import { expect, test } from "bun:test";

import { unzip } from "@corbits/zip";

import { validateDeck, writePptx, type DeckInput } from "../src/index.ts";
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
  for (const index of [1, 3, 8, 9])
    expect(paths).toContain(`ppt/notesSlides/notesSlide${index}.xml`);
  expect(
    paths.filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)),
  ).toHaveLength(9);
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
    for (const [, target = "", external] of xml.matchAll(
      /Target="([^"]+)"( TargetMode="External")?/g,
    ))
      if (external) expect(target).toMatch(/^(https?|mailto):/);
      else expect(paths).toContain(new URL(target, base).pathname.slice(1));
  }
});

test("an invalid deck names the slide and field", () => {
  const result = validateDeck({
    ...deck,
    slides: [
      deck.slides[0],
      { layout: "content", body: [] },
      {
        layout: "blank",
        body: [
          {
            type: "paragraph",
            text: [{ text: "Run", link: "JavaScript:alert(1)" }],
          },
        ],
      },
    ],
  });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues).toEqual([
    expect.objectContaining({ slide: 1, path: "slides[1].title" }),
    expect.objectContaining({
      slide: 2,
      path: "slides[2].body[0].text[0].link",
    }),
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

test("only a deck with an image slide carries the Picture with Caption layout, which Keynote otherwise warns about", async () => {
  const written = async (input: DeckInput) => {
    const parts = new Map(
      (await unzip(await writePptx(input, assets))).map(({ path, data }) => [
        path,
        new TextDecoder().decode(data),
      ]),
    );
    const layoutType = (path: string) =>
      parts.get(path)?.match(/<p:sldLayout [^>]* type="(\w+)"/)?.[1];
    const layouts = [...parts.keys()].filter((path) =>
      /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path),
    );
    return {
      layouts: layouts.map(layoutType),
      listed: parts
        .get("ppt/slideMasters/slideMaster1.xml")
        ?.match(/<p:sldLayoutId /g)?.length,
      slides: input.slides.map((_, index) =>
        layoutType(
          `ppt/slideLayouts/${parts.get(`ppt/slides/_rels/slide${index + 1}.xml.rels`)?.match(/slideLayouts\/(slideLayout\d+\.xml)/)?.[1]}`,
        ),
      ),
    };
  };
  const withImages = await written(deck);
  const withoutImages = await written({
    ...deck,
    slides: deck.slides.map((slide) =>
      slide.layout === "image" ? { layout: "blank", body: [] } : slide,
    ),
  });

  expect(withImages.layouts).toContain("picTx");
  expect(withImages.listed).toBe(withImages.layouts.length);
  expect(withoutImages.layouts).not.toContain("picTx");
  expect(withoutImages.listed).toBe(withoutImages.layouts.length);
  expect(withoutImages.slides).toEqual(
    withImages.slides.map((type) => (type === "picTx" ? "blank" : type)),
  );
});

test("a missing slide link or a list past five levels names the slide and field", () => {
  const nested = (levels: number) => {
    let item: unknown = "Too deep";
    for (let level = levels - 1; level > 0; level--)
      item = { text: `Level ${level}`, items: [item] };
    return { layout: "blank", body: [{ type: "list", items: [item] }] };
  };
  const link = { text: "Appendix", link: 9 };
  expect(
    validateDeck({
      ...deck,
      slides: [
        deck.slides[0],
        { layout: "blank", body: [{ type: "list", items: [[link]] }] },
      ],
    }),
  ).toEqual({
    ok: false,
    issues: [
      {
        slide: 1,
        path: "slides[1].body[0].items[0][0].link",
        message:
          "slides[1].body[0].items[0][0].link links to slide 9, but the deck has 2 slides",
      },
    ],
  });

  const tooDeep = `slides[1].body[0]${".items[0]".repeat(5)}.items`;
  for (const levels of [6, 10_000])
    expect(
      validateDeck({ ...deck, slides: [deck.slides[0], nested(levels)] }),
    ).toEqual({
      ok: false,
      issues: [
        {
          slide: 1,
          path: tooDeep,
          message: `${tooDeep} nests lists deeper than 5 levels`,
        },
      ],
    });
});

test("a free slide names the element of every problem, and groups past ten levels", () => {
  const box = { x: 0, y: 0, w: 10, h: 10 };
  const image = { type: "image", image: { path: "a.png" }, ...box };
  const free = (elements: unknown[], animations: unknown[] = []) => ({
    ...deck,
    slides: [deck.slides[0], { layout: "free", elements, animations }],
  });
  const at = (path: string, message: string) => ({
    slide: 1,
    path,
    message: `${path} ${message}`,
  });
  expect(
    validateDeck(
      free(
        [
          { id: "a", type: "shape", geometry: "rect", ...box, link: 5 },
          {
            type: "group",
            children: [
              {
                ...image,
                id: "a",
                fit: "cover",
                crop: { top: 0.1, right: 0, bottom: 0, left: 0 },
              },
              {
                ...image,
                id: "c",
                crop: { top: 0.5, right: 0, bottom: 0.5, left: 0 },
                shadow: { x: 0, y: 0, blur: 0, spread: -6, color: "text" },
              },
            ],
          },
          { id: "d", type: "shape", geometry: "rect", ...box },
        ],
        [
          { target: "b", effect: "pulse", easing: { accel: 0.7, decel: 0.7 } },
          { target: "c", effect: "pulse", repeat: "indefinite" },
          { target: "d", effect: "pulse", trigger: "withPrevious" },
          { target: "d", effect: "pulse", trigger: "afterPrevious" },
        ],
      ),
    ),
  ).toEqual({
    ok: false,
    issues: [
      at(
        "slides[1].elements[1].children[0].id",
        'repeats the id "a" on this slide',
      ),
      at(
        "slides[1].elements[1].children[0].crop",
        "needs fit 'fill', not 'cover'",
      ),
      at(
        "slides[1].elements[1].children[1].crop",
        "cuts away the whole image on one axis",
      ),
      at(
        "slides[1].elements[1].children[1].shadow.spread",
        "shrinks the shadow past nothing; it can be no less than minus half the shorter side",
      ),
      at(
        "slides[1].animations[0].target",
        'names "b", which no element on this slide has as its id',
      ),
      at(
        "slides[1].animations[0].easing",
        "has accel and decel adding up past 1",
      ),
      at(
        "slides[1].animations[1].target",
        'names "c", which is inside a group; animate the whole group or an element directly on the slide',
      ),
      at(
        "slides[1].animations[3].trigger",
        "waits for an animation that repeats indefinitely and never ends",
      ),
      at(
        "slides[1].elements[0].link",
        "links to slide 5, but the deck has 2 slides",
      ),
    ],
  });

  const nested = (levels: number) => {
    let element: unknown = image;
    for (let level = 0; level < levels; level++)
      element = { type: "group", children: [element] };
    return free([element]);
  };
  const tooDeep = `slides[1].elements[0]${".children[0]".repeat(10)}.children`;
  for (const levels of [11, 10_000])
    expect(validateDeck(nested(levels))).toEqual({
      ok: false,
      issues: [at(tooDeep, "nests groups deeper than 10 levels")],
    });
  expect(validateDeck(nested(10)).ok).toBe(true);
});

test("each effect on a shape is its own build, and wipes travel away from their side", async () => {
  const parts = await unzip(await writePptx(deck, assets));
  const timed = parts
    .map(({ data }) => new TextDecoder().decode(data))
    .find((xml) => xml.includes("<p:timing>"));
  if (timed === undefined) throw new Error("no slide has a timing tree");
  const effects = [
    ...timed.matchAll(
      /grpId="(\d+)" nodeType="\w+"><p:stCondLst>.*?<p:spTgt spid="(\d+)"\/>/g,
    ),
  ].map(([, grpId, spid]) => `${spid}:${grpId}`);
  expect(effects.length).toBeGreaterThan(
    new Set(effects.map((each) => each.split(":")[0])).size,
  );
  expect(new Set(effects).size).toBe(effects.length);
  for (const [, spid, grpId] of timed.matchAll(
    /<p:bldP spid="(\d+)" grpId="(\d+)"/g,
  ))
    expect(effects).toContain(`${spid}:${grpId}`);
  const wipes = [...timed.matchAll(/filter="(wipe\(\w+\))"/g)].map(
    ([, filter]) => filter,
  );
  expect(wipes).toEqual(["wipe(right)", "wipe(left)"]);
});
