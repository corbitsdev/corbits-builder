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
  createDeckTools,
  type CheckedDeckArtifact,
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

const toolEnv = (toolCwd: string) =>
  ({ toolCwd }) as unknown as Parameters<ReturnType<typeof createDeckTools>>[0];

test("write_deck and check_deck write .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf and verify issues", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-"));
  try {
    const checkedArtifacts: CheckedDeckArtifact[] = [];
    const tool = createDeckTools({
      onDeckChecked: async (artifact) => {
        checkedArtifacts.push(artifact);
      },
    })(toolEnv(workspace));
    expect(tool.definitions.map((d) => d.name)).toEqual([
      "write_deck",
      "check_deck",
    ]);

    const writeRes = await tool.run(
      {
        id: "call-1",
        name: "write_deck",
        arguments: { deck: sampleDeck },
      },
      new AbortController().signal,
    );
    expect(writeRes.isError).toBeUndefined();
    const written = JSON.parse(String(writeRes.content));
    expect(written).toEqual({
      slideCount: 2,
      pptxBytes: expect.any(Number),
      pdfBytes: expect.any(Number),
      passed: true,
      issues: [],
    });

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
    expect(checkedArtifacts).toHaveLength(0);

    const checkRes = await tool.run(
      {
        id: "call-2",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(checkRes.isError).toBeUndefined();
    expect(JSON.parse(String(checkRes.content))).toEqual({
      passed: true,
      issues: [],
    });
    expect(checkedArtifacts).toHaveLength(1);
    expect(checkedArtifacts[0]?.pptxBytes.byteLength).toBe(written.pptxBytes);
    expect(checkedArtifacts[0]?.pdfBytes.byteLength).toBe(written.pdfBytes);
    expect(checkedArtifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(checkedArtifacts[0]?.pptxSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(checkedArtifacts[0]?.pdfSha256).toMatch(/^[a-f0-9]{64}$/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("write_deck and check_deck return isError: true naming the slide and field on validation or check failures", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "deck-tools-err-"));
  try {
    let checkedCallbackCount = 0;
    const tool = createDeckTools({
      onDeckChecked: async () => {
        checkedCallbackCount += 1;
      },
    })(toolEnv(workspace));

    const invalidRes = await tool.run(
      {
        id: "call-bad",
        name: "write_deck",
        arguments: {
          deck: {
            ...sampleDeck,
            slides: [{ layout: "content", body: [] }],
          },
        },
      },
      new AbortController().signal,
    );
    expect(invalidRes.isError).toBe(true);
    const invalidBody = JSON.parse(String(invalidRes.content));
    expect(invalidBody.passed).toBe(false);
    expect(invalidBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].title",
      }),
    ]);

    // Call write_deck with a check-only failure (low contrast) and verify it returns isError: true and writes NONE of deck.json, deck.pptx, or deck.pdf.
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
    const writeCheckFailRes = await tool.run(
      {
        id: "call-write-check-fail",
        name: "write_deck",
        arguments: { deck: lowContrastDeck },
      },
      new AbortController().signal,
    );
    expect(writeCheckFailRes.isError).toBe(true);
    const writeCheckFailBody = JSON.parse(String(writeCheckFailRes.content));
    expect(writeCheckFailBody.passed).toBe(false);
    expect(writeCheckFailBody.pptxBytes).toBe(0);
    expect(writeCheckFailBody.pdfBytes).toBe(0);
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

    // Write the low-contrast deck.json manually to verify check_deck also refuses and does not invoke onDeckChecked.
    await mkdir(join(workspace, ".builder"), { recursive: true });
    await writeFile(
      join(workspace, DECK_JSON),
      `${JSON.stringify(lowContrastDeck, null, 2)}\n`,
      "utf8",
    );

    const directCheck = await checkDeckInWorkspace(workspace);
    expect(directCheck.passed).toBe(false);

    const checkRes = await tool.run(
      {
        id: "call-check-fail",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(checkRes.isError).toBe(true);
    const checkBody = JSON.parse(String(checkRes.content));
    expect(checkBody.passed).toBe(false);
    expect(checkBody.issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].body[0].text[0]",
        message: expect.stringContaining("contrast"),
      }),
    ]);
    expect(checkedCallbackCount).toBe(0);

    // Also verify missing image asset in .builder/deck.json fails check_deck.
    await mkdir(join(workspace, ".builder"), { recursive: true });
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
    const missingImgRes = await tool.run(
      {
        id: "call-missing-img",
        name: "check_deck",
        arguments: {},
      },
      new AbortController().signal,
    );
    expect(missingImgRes.isError).toBe(true);
    expect(JSON.parse(String(missingImgRes.content)).issues).toEqual([
      expect.objectContaining({
        slide: 0,
        path: "slides[0].image",
      }),
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
