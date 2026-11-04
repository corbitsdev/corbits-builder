import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { type } from "arktype";
import {
  Deck,
  assetKey,
  assetUses,
  checkDeck,
  validateDeck,
  writeDeckPdf,
  writePptx,
  type Assets,
  type Deck as SlideDeck,
  type DeckIssue,
} from "@corbits/slidedeck";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";
import { parseJson } from "../lib/json.ts";
import { failure } from "./tools.ts";

interface DeckToolEnv extends BaseEnv {
  toolCwd: string;
}

export const DECK_JSON = ".builder/deck.json";
export const DECK_PPTX = ".builder/deck.pptx";
export const DECK_PDF = ".builder/deck.pdf";
export const DECK_CHECK = ".builder/deck-check.json";

const HexSha256 = /^[a-f0-9]{64}$/;

// check_deck's verdict on the exact deck, slides file and handout it checked, so filing refuses a
// deck changed after it passed.
const DeckCheckRecord = type({
  "+": "ignore",
  passed: "boolean",
  sha256: HexSha256,
  pptxSha256: HexSha256,
  pdfSha256: HexSha256,
  checklist: "string",
});
type DeckCheckRecord = typeof DeckCheckRecord.infer;

const WriteDeckArgs = type({
  "+": "ignore",
  deck: Deck,
});

function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readDeckFiles(workspace: string) {
  const deckText = (await readIfPresent(join(workspace, DECK_JSON)))?.toString(
    "utf8",
  );
  const pptxBytes = await readIfPresent(join(workspace, DECK_PPTX));
  const pdfBytes = await readIfPresent(join(workspace, DECK_PDF));
  if (!deckText || !pptxBytes?.byteLength || !pdfBytes?.byteLength)
    return undefined;
  return { deckText, pptxBytes, pdfBytes };
}

function issueLines(issues: readonly DeckIssue[], separator: string): string {
  return issues
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(separator);
}

async function resolveWorkspaceAssets(
  workspace: string,
  deck: SlideDeck,
): Promise<Assets> {
  const assets = new Map<string, Uint8Array<ArrayBuffer>>();
  const root = await realpath(workspace);
  for (const { ref } of assetUses(deck)) {
    const key = assetKey(ref);
    if (assets.has(key) || !("path" in ref)) continue;
    const candidate = resolve(root, ref.path);
    if (!candidate.startsWith(root + sep)) continue;
    try {
      const target = await realpath(candidate);
      if (!target.startsWith(root + sep)) continue;
      const bytes = await readFile(target);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      assets.set(key, copy);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR")
        throw error;
    }
  }
  return assets;
}

async function writeDeckToWorkspace(workspace: string, deck: SlideDeck) {
  const assets = await resolveWorkspaceAssets(workspace, deck);
  const issues = checkDeck(deck, assets);
  if (issues.length > 0) {
    for (const path of [DECK_JSON, DECK_PPTX, DECK_PDF, DECK_CHECK])
      await rm(join(workspace, path), { force: true });
    return { passed: false, issues };
  }
  const jsonTarget = join(workspace, DECK_JSON);
  await mkdir(dirname(jsonTarget), { recursive: true });
  await writeFile(jsonTarget, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, DECK_PPTX), await writePptx(deck, assets));
  await writeFile(join(workspace, DECK_PDF), writeDeckPdf(deck, assets));
  return { passed: true, issues };
}

async function runWriteDeck(
  workspace: string,
  callId: string,
  rawArgs: unknown,
) {
  const input = WriteDeckArgs(rawArgs);
  if (input instanceof type.errors) {
    return {
      callId,
      content: `invalid_deck: ${input.summary}`,
      isError: true,
    };
  }
  const validated = validateDeck(input.deck);
  if (!validated.ok) {
    return {
      callId,
      content: `invalid_deck: ${issueLines(validated.issues, "; ")}`,
      isError: true,
    };
  }
  const written = await writeDeckToWorkspace(workspace, validated.deck);
  return {
    callId,
    content: JSON.stringify({
      slides: validated.deck.slides.length,
      deckPath: DECK_JSON,
      pptxPath: DECK_PPTX,
      pdfPath: DECK_PDF,
      passed: written.passed,
      issues: written.issues,
    }),
    ...(written.passed ? {} : { isError: true }),
  };
}

async function recordDeckCheck(
  workspace: string,
  record: DeckCheckRecord,
): Promise<void> {
  const target = join(workspace, DECK_CHECK);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2), "utf8");
}

async function runCheckDeck(workspace: string, callId: string) {
  const files = await readDeckFiles(workspace);
  if (!files) {
    return {
      callId,
      content: `deck_check_failed: ${DECK_JSON}, ${DECK_PPTX} and ${DECK_PDF} must be written first`,
      isError: true,
    };
  }
  const hashes = {
    sha256: sha256Hex(files.deckText),
    pptxSha256: sha256Hex(files.pptxBytes),
    pdfSha256: sha256Hex(files.pdfBytes),
  };
  const validated = validateDeck(parseJson(files.deckText));
  const issues = validated.ok
    ? checkDeck(
        validated.deck,
        await resolveWorkspaceAssets(workspace, validated.deck),
      )
    : validated.issues;
  if (issues.length > 0) {
    const checklist = issueLines(issues, "\n");
    await recordDeckCheck(workspace, { passed: false, ...hashes, checklist });
    return {
      callId,
      content: `deck_check_failed:\n${checklist}`,
      isError: true,
    };
  }
  const checklist = `check passed: verified ${DECK_JSON}, ${DECK_PPTX} and ${DECK_PDF}.`;
  await recordDeckCheck(workspace, { passed: true, ...hashes, checklist });
  return { callId, content: checklist };
}

/** The workspace's deck and its renders, refused unless check_deck passed on exactly these files. */
export async function readCheckedDeck(
  workspace: string,
): Promise<
  | { ok: true; deck: SlideDeck; pptxBytes: Buffer; pdfBytes: Buffer }
  | { ok: false; message: string }
> {
  const files = await readDeckFiles(workspace);
  if (!files) {
    return {
      ok: false,
      message: `deck_check_failed: ${DECK_JSON}, ${DECK_PPTX} and ${DECK_PDF} must exist before filing`,
    };
  }
  const recordText = await readIfPresent(join(workspace, DECK_CHECK));
  if (recordText === undefined) {
    return {
      ok: false,
      message:
        "deck_check_failed: check_deck has not run on the current deck yet",
    };
  }
  const record = DeckCheckRecord(parseJson(recordText.toString("utf8")));
  if (record instanceof type.errors) {
    return {
      ok: false,
      message: `deck_check_failed: invalid ${DECK_CHECK} (${record.summary})`,
    };
  }
  if (!record.passed) {
    return {
      ok: false,
      message: `deck_check_failed: the deck is filed only once check_deck passes.\n${record.checklist}`,
    };
  }
  for (const [path, recorded, current] of [
    [DECK_JSON, record.sha256, files.deckText],
    [DECK_PPTX, record.pptxSha256, files.pptxBytes],
    [DECK_PDF, record.pdfSha256, files.pdfBytes],
  ] as const) {
    if (recorded !== sha256Hex(current)) {
      return {
        ok: false,
        message: `deck_check_failed: ${path} changed after check_deck passed; run check_deck again`,
      };
    }
  }
  const validated = validateDeck(parseJson(files.deckText));
  if (!validated.ok) {
    return {
      ok: false,
      message: `deck_check_failed: ${issueLines(validated.issues, "; ")}`,
    };
  }
  return {
    ok: true,
    deck: validated.deck,
    pptxBytes: files.pptxBytes,
    pdfBytes: files.pdfBytes,
  };
}

export function createDeckTools() {
  const definitions = [
    {
      name: "write_deck",
      description: `Write the slide deck to ${DECK_JSON} and render ${DECK_PPTX} and ${DECK_PDF}.`,
      inputSchema: {
        type: "object",
        properties: {
          deck: Deck.toJsonSchema({ fallback: { default: (ctx) => ctx.base } }),
        },
        required: ["deck"],
        additionalProperties: false,
      },
    },
    {
      name: "check_deck",
      description: `Check ${DECK_JSON}, ${DECK_PPTX} and ${DECK_PDF} for structural and visual validity before filing the approval package.`,
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ];
  return defineTool<DeckToolEnv>({
    id: "@corbits-builder/artifacts/deck-tools",
    requires: ["toolCwd"],
    definitions: [{ name: "write_deck" }, { name: "check_deck" }],
    factory: (env) => ({
      definitions,
      run: async (call) => {
        try {
          const workspace = await realpath(env.toolCwd);
          if (call.name === "write_deck")
            return await runWriteDeck(workspace, call.id, call.arguments);
          if (call.name === "check_deck")
            return await runCheckDeck(workspace, call.id);
          return {
            callId: call.id,
            content: "unknown_deck_tool",
            isError: true,
          };
        } catch (error) {
          return failure(call.id, error);
        }
      },
    }),
  });
}
