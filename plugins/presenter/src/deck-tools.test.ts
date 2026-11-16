import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzip } from "@corbits/zip";

import {
  DECK_JSON,
  DECK_PDF,
  DECK_PPTX,
  checkDeckInWorkspace,
  writeDeckToWorkspace,
} from "./deck-tools.ts";

const sampleDeck = {
  theme: {
    colors: {
      primary: "#6D28D9",
      secondary: "#0EA5E9",
      accent: "#F59E0B",
      background: "#FFFFFF",
      text: "#1B1B1F",
      muted: "#6B7280",
    },
    fonts: { heading: "Georgia", body: "Helvetica Neue" },
  },
  footer: { text: "Builder · Deck Tools", slideNumbers: true },
  slides: [
    {
      layout: "title",
      title: "Quarter Review",
      subtitle: "Deterministic slides and PDF",
    },
    {
      layout: "content",
      title: "Key results",
      body: [
        {
          type: "paragraph",
          text: "Every check runs in pure TypeScript.",
        },
        {
          type: "list",
          ordered: true,
          items: [
            "Validate schema",
            "Check overflow and contrast",
            "Render PPTX and PDF",
          ],
        },
      ],
    },
  ],
};

test("workspace helpers write deck JSON, PPTX and PDF and verify issues", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-"));
  try {
    const written = await writeDeckToWorkspace(workspace, sampleDeck);
    expect(written).toMatchObject({
      slideCount: 2,
      passed: true,
      issues: [],
    });

    expect(written.pptxBytes).toBeGreaterThan(0);
    expect(written.pdfBytes).toBeGreaterThan(0);

    const pptxBytes = new Uint8Array(
      await readFile(join(workspace, DECK_PPTX)),
    );
    const pdfBytes = new Uint8Array(await readFile(join(workspace, DECK_PDF)));
    expect(pptxBytes.byteLength).toBe(written.pptxBytes);
    expect(pdfBytes.byteLength).toBe(written.pdfBytes);
    const entries = await unzip(pptxBytes);
    expect(entries.some((e) => e.path === "ppt/slides/slide1.xml")).toBe(true);
    expect(entries.some((e) => e.path === "ppt/slides/slide2.xml")).toBe(true);
    expect(new TextDecoder("latin1").decode(pdfBytes)).toContain(
      "(Quarter Review) Tj",
    );
    expect(await checkDeckInWorkspace(workspace)).toEqual({
      passed: true,
      issues: [],
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("workspace helpers name the slide and field on validation or check failures", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-err-"));
  try {
    await expect(
      writeDeckToWorkspace(workspace, {
        theme: sampleDeck.theme,
        slides: [{ layout: "content", body: [] }],
      }),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          slide: 0,
          path: "slides[0].title",
        }),
      ],
    });

    const lowContrastDeck = {
      theme: sampleDeck.theme,
      footer: sampleDeck.footer,
      slides: [
        {
          layout: "content",
          title: "Low contrast slide",
          body: [
            {
              type: "paragraph",
              text: [{ text: "Unreadable light text", color: "#E5E7EB" }],
            },
          ],
        },
      ],
    };
    const written = await writeDeckToWorkspace(workspace, lowContrastDeck);
    expect(written.passed).toBe(false);
    expect(written.pptxBytes).toBe(0);
    expect(written.pdfBytes).toBe(0);
    expect(written.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);
    await expect(readFile(join(workspace, DECK_JSON))).rejects.toThrow();
    await expect(readFile(join(workspace, DECK_PPTX))).rejects.toThrow();
    await expect(readFile(join(workspace, DECK_PDF))).rejects.toThrow();

    await mkdir(join(workspace, ".builder"), { recursive: true });
    await writeFile(
      join(workspace, DECK_JSON),
      `${JSON.stringify(lowContrastDeck, null, 2)}\n`,
      "utf8",
    );

    const checked = await checkDeckInWorkspace(workspace);
    expect(checked.passed).toBe(false);
    expect(checked.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);

    await mkdir(join(workspace, ".builder"), { recursive: true });
    await writeFile(
      join(workspace, DECK_JSON),
      JSON.stringify({
        theme: sampleDeck.theme,
        footer: sampleDeck.footer,
        slides: [
          {
            layout: "image",
            title: "Missing image",
            image: { path: "does-not-exist.png" },
          },
        ],
      }),
    );
    const missingImage = await checkDeckInWorkspace(workspace);
    expect(missingImage.passed).toBe(false);
    expect(missingImage.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].image",
      }),
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
