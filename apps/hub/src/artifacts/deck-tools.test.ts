import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzip } from "@corbits/zip";

import {
  DECK_JSON,
  DECK_PDF,
  DECK_PPTX,
  createDeckTools,
  readCheckedDeck,
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
      layout: "title" as const,
      title: "Quarter Review",
      subtitle: "Deterministic slides and PDF",
    },
    {
      layout: "content" as const,
      title: "Key results",
      body: [
        {
          type: "paragraph" as const,
          text: "Every check runs in pure TypeScript.",
        },
        {
          type: "list" as const,
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

const signal = new AbortController().signal;

const runDeckTool = (
  workspace: string,
  name: string,
  args: Record<string, unknown> = {},
) =>
  createDeckTools()({ toolCwd: workspace } as never).run(
    { id: `call-${name}`, name, arguments: args },
    signal,
  );

test("write_deck renders the deck and check_deck passes it for filing", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-"));
  try {
    const writeRes = await runDeckTool(workspace, "write_deck", {
      deck: sampleDeck,
    });
    expect(writeRes.isError).toBeUndefined();
    expect(JSON.parse(String(writeRes.content))).toEqual({
      slides: 2,
      deckPath: DECK_JSON,
      pptxPath: DECK_PPTX,
      pdfPath: DECK_PDF,
      passed: true,
      issues: [],
    });
    const pptxBytes = new Uint8Array(
      await readFile(join(workspace, DECK_PPTX)),
    );
    const pdfBytes = new Uint8Array(await readFile(join(workspace, DECK_PDF)));
    const entries = await unzip(pptxBytes);
    expect(entries.some((e) => e.path === "ppt/slides/slide1.xml")).toBe(true);
    expect(entries.some((e) => e.path === "ppt/slides/slide2.xml")).toBe(true);
    expect(new TextDecoder("latin1").decode(pdfBytes)).toContain(
      "(Quarter Review) Tj",
    );
    expect((await readCheckedDeck(workspace)).ok).toBe(false);

    const checkRes = await runDeckTool(workspace, "check_deck");
    expect(checkRes.isError).toBeUndefined();
    expect(checkRes.content).toStartWith("check passed:");
    const checked = await readCheckedDeck(workspace);
    expect(checked.ok && checked.deck.slides).toHaveLength(2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("write_deck and check_deck refuse naming the slide and field on validation or check failures", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-err-"));
  try {
    const invalidRes = await runDeckTool(workspace, "write_deck", {
      deck: { ...sampleDeck, slides: [{ layout: "content", body: [] }] },
    });
    expect(invalidRes.isError).toBe(true);
    expect(invalidRes.content).toStartWith("invalid_deck:");
    expect(invalidRes.content).toContain("slides[0].title");

    const lowContrastDeck = {
      ...sampleDeck,
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
    const writeCheckFailRes = await runDeckTool(workspace, "write_deck", {
      deck: lowContrastDeck,
    });
    expect(writeCheckFailRes.isError).toBe(true);
    const writeCheckFailBody = JSON.parse(String(writeCheckFailRes.content));
    expect(writeCheckFailBody.passed).toBe(false);
    expect(writeCheckFailBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);
    await expect(readFile(join(workspace, DECK_JSON))).rejects.toThrow();
    await expect(readFile(join(workspace, DECK_PPTX))).rejects.toThrow();
    await expect(readFile(join(workspace, DECK_PDF))).rejects.toThrow();

    // A deck.json edited by hand after rendering is checked again on its own.
    await runDeckTool(workspace, "write_deck", { deck: sampleDeck });
    await writeFile(
      join(workspace, DECK_JSON),
      `${JSON.stringify(lowContrastDeck, null, 2)}\n`,
      "utf8",
    );
    const checkRes = await runDeckTool(workspace, "check_deck");
    expect(checkRes.isError).toBe(true);
    expect(checkRes.content).toStartWith("deck_check_failed:");
    expect(checkRes.content).toContain("slides[0].body[0].text[0]");
    expect((await readCheckedDeck(workspace)).ok).toBe(false);

    await writeFile(
      join(workspace, DECK_JSON),
      JSON.stringify({
        ...sampleDeck,
        slides: [
          {
            layout: "image",
            title: "Missing image",
            image: { path: "does-not-exist.png" },
          },
        ],
      }),
    );
    const missingImgRes = await runDeckTool(workspace, "check_deck");
    expect(missingImgRes.isError).toBe(true);
    expect(missingImgRes.content).toContain("slides[0].image");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
