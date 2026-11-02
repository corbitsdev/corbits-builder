import { expect, test } from "bun:test";

import { assets, deck } from "../test/fixture.ts";
import {
  DeckError,
  assetKey,
  checkDeck,
  contrastRatio,
  writeDeckPdf,
  writePdf,
  type DeckInput,
} from "./index.ts";

test("the fixture deck passes checkDeck with accessible theme tokens and renders a 9-page 16:9 PDF deterministically", () => {
  const accessibleFixture: DeckInput = {
    ...deck,
    theme: {
      ...deck.theme,
      colors: {
        ...deck.theme!.colors,
        secondary: "#0369A1",
      },
    },
    slides: deck.slides.map((slide, idx) =>
      idx === 8 && slide.layout === "free"
        ? {
            ...slide,
            elements: slide.elements.map((el) =>
              el.type === "text" && el.id === "headline"
                ? {
                    ...el,
                    paragraphs: el.paragraphs.map((p, pIdx) =>
                      pIdx === 1
                        ? {
                            ...p,
                            runs: p.runs.map((r) =>
                              typeof r === "object" && r.color === "#0EA5E9"
                                ? { ...r, color: "#0369A1" }
                                : r,
                            ),
                          }
                        : p,
                    ),
                  }
                : el,
            ),
          }
        : slide,
    ),
  };
  expect(checkDeck(accessibleFixture, assets)).toEqual([]);

  const first = writePdf(accessibleFixture, assets);
  const second = writeDeckPdf(accessibleFixture, assets);
  expect(second).toEqual(first);

  const pdfText = new TextDecoder("latin1").decode(first);
  expect(pdfText.startsWith("%PDF-1.4\n")).toBe(true);
  expect(pdfText).toContain("/Count 9");
  expect(pdfText).toContain("/MediaBox [0 0 960 540]");
  expect(pdfText).toContain("(Builder overview) Tj");
  expect(pdfText).toContain("(Why now) Tj");
  expect(pdfText).toContain("(What Builder does) Tj");
  expect(pdfText).toContain("(Designed) Tj");
});

test("checkDeck reports empty placeholders, empty block regions and empty free slides", () => {
  const issues = checkDeck(
    {
      ...deck,
      slides: [
        { layout: "title", title: "   " },
        { layout: "content", title: "Empty body", body: [] },
        {
          layout: "two-column",
          title: "Columns",
          left: [{ type: "paragraph", text: "   " }],
          right: [],
        },
        { layout: "free", elements: [] },
        {
          layout: "free",
          elements: [
            {
              type: "text",
              x: 40,
              y: 40,
              w: 300,
              h: 100,
              paragraphs: [{ runs: ["   "] }],
            },
          ],
        },
      ],
    },
    assets,
  );

  expect(issues).toEqual([
    expect.objectContaining({ slide: 0, path: "slides[0].title" }),
    expect.objectContaining({ slide: 1, path: "slides[1].body" }),
    expect.objectContaining({ slide: 2, path: "slides[2].left[0].text" }),
    expect.objectContaining({ slide: 2, path: "slides[2].right" }),
    expect.objectContaining({ slide: 3, path: "slides[3].elements" }),
    expect.objectContaining({
      slide: 4,
      path: "slides[4].elements[0].paragraphs",
    }),
  ]);
});

test("checkDeck reports text overflow in layout placeholders and free text boxes", () => {
  const longParagraph = "Overflowing content line with many words. ".repeat(40);
  const issues = checkDeck(
    {
      ...deck,
      slides: [
        {
          layout: "content",
          title: "Line one\nLine two\nLine three",
          body: [{ type: "paragraph", text: longParagraph }],
        },
        {
          layout: "free",
          elements: [
            {
              type: "text",
              x: 40,
              y: 40,
              w: 160,
              h: 40,
              paragraphs: [
                {
                  runs: [
                    {
                      text: "This text is far too long to fit inside a 160x40 pixel box.",
                      size: 24,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    assets,
  );

  expect(issues).toEqual([
    expect.objectContaining({
      slide: 0,
      path: "slides[0].title",
      message: expect.stringContaining("overflows"),
    }),
    expect.objectContaining({
      slide: 0,
      path: "slides[0].body",
      message: expect.stringContaining("overflows"),
    }),
    expect.objectContaining({
      slide: 1,
      path: "slides[1].elements[0]",
      message: expect.stringContaining("overflows"),
    }),
  ]);
});

test("checkDeck and writePdf report missing and corrupt image assets with slide index", () => {
  const broken = { path: "broken.png" };
  const missing = { path: "missing.png" };
  const badDeck: DeckInput = {
    ...deck,
    slides: [
      { layout: "image", title: "Broken", image: broken },
      {
        layout: "free",
        elements: [
          {
            type: "image",
            x: 10,
            y: 10,
            w: 100,
            h: 100,
            image: missing,
          },
        ],
      },
    ],
  };
  const partialAssets = new Map([
    ...assets,
    [assetKey(broken), new Uint8Array([1, 2, 3])],
  ]);

  const issues = checkDeck(badDeck, partialAssets);
  expect(issues).toEqual([
    expect.objectContaining({
      slide: 0,
      path: "slides[0].image",
      message: expect.stringContaining("not a PNG or JPEG"),
    }),
    expect.objectContaining({
      slide: 1,
      path: "slides[1].elements[0].image",
      message: expect.stringContaining("was not provided"),
    }),
  ]);
  expect(() => writePdf(badDeck, partialAssets)).toThrow(DeckError);
});

test("checkDeck enforces WCAG contrast thresholds for normal and large text", () => {
  expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 2);
  expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);

  const issues = checkDeck(
    {
      ...deck,
      slides: [
        {
          layout: "content",
          title: "Contrast check",
          body: [
            {
              type: "paragraph",
              text: [
                // #EA580C on #FFFFFF has 3.56:1 contrast: passes at 28pt (>= 24pt large text), fails at 16pt (< 4.5:1)
                { text: "Large orange passes", size: 28, color: "#EA580C" },
                { text: "Small orange fails", size: 16, color: "#EA580C" },
              ],
            },
          ],
        },
        {
          layout: "free",
          background: "#FFFFFF",
          elements: [
            {
              type: "text",
              x: 40,
              y: 40,
              w: 400,
              h: 100,
              paragraphs: [
                {
                  runs: [
                    { text: "Light gray on white", size: 36, color: "#D1D5DB" },
                  ],
                },
              ],
            },
          ],
        },
        {
          layout: "free",
          background: "#000000",
          elements: [
            {
              type: "shape",
              geometry: "rect",
              x: 20,
              y: 20,
              w: 500,
              h: 200,
              fill: "#FFFFFF",
            },
            {
              type: "text",
              x: 40,
              y: 40,
              w: 400,
              h: 100,
              paragraphs: [
                {
                  runs: [
                    {
                      text: "White text on white shape over black slide",
                      size: 24,
                      color: "#FFFFFF",
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          layout: "free",
          background: {
            type: "linear",
            angle: 90,
            stops: [
              { at: 0, color: "#000000" },
              { at: 100, color: "#FFFFFF" },
            ],
          },
          elements: [
            {
              type: "text",
              x: 40,
              y: 40,
              w: 400,
              h: 100,
              paragraphs: [
                {
                  runs: [
                    {
                      text: "White text over black-to-white gradient",
                      size: 24,
                      color: "#FFFFFF",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    assets,
  );

  expect(issues).toEqual([
    expect.objectContaining({
      slide: 0,
      path: "slides[0].body[0].text[1]",
      message: expect.stringContaining("contrast"),
    }),
    expect.objectContaining({
      slide: 1,
      path: "slides[1].elements[0].paragraphs[0].runs[0]",
      message: expect.stringContaining("contrast"),
    }),
    expect.objectContaining({
      slide: 2,
      path: "slides[2].elements[1].paragraphs[0].runs[0]",
      message: expect.stringContaining("contrast"),
    }),
    expect.objectContaining({
      slide: 3,
      path: "slides[3].elements[0].paragraphs[0].runs[0]",
      message: expect.stringContaining("contrast"),
    }),
  ]);
});
