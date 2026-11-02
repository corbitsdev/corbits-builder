import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  Deck,
  DeckError,
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

interface DeckToolEnv extends BaseEnv {
  toolCwd: string;
}

export interface CheckedDeckArtifact {
  deck: SlideDeck;
  jsonBytes: Uint8Array;
  pptxBytes: Uint8Array;
  pdfBytes: Uint8Array;
  sha256: string;
  pptxSha256: string;
  pdfSha256: string;
}

export interface DeckToolsOptions {
  assets?: Assets;
  onDeckChecked?: (artifact: CheckedDeckArtifact) => Promise<void>;
}

export const DECK_JSON = ".builder/deck.json";
export const DECK_PPTX = ".builder/deck.pptx";
export const DECK_PDF = ".builder/deck.pdf";
const DECK_CHECK_PATH = ".builder/deck-check.json";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAssetsMap(
  optionsOrAssets: Assets | DeckToolsOptions,
): optionsOrAssets is Assets {
  return optionsOrAssets instanceof Map;
}

function normalizeDeckToolsOptions(
  optionsOrAssets?: Assets | DeckToolsOptions,
): DeckToolsOptions {
  if (!optionsOrAssets) return {};
  if (isAssetsMap(optionsOrAssets)) {
    return { assets: optionsOrAssets };
  }
  return optionsOrAssets;
}

async function readExistingBytes(
  filePath: string,
): Promise<Uint8Array | undefined> {
  try {
    return new Uint8Array(await readFile(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveWorkspaceAssets(
  workspace: string,
  deck: SlideDeck,
  provided?: Assets,
): Promise<Assets> {
  const merged = new Map<string, Uint8Array<ArrayBuffer>>(provided);
  const root = await realpath(workspace);
  for (const { ref } of assetUses(deck)) {
    const key = assetKey(ref);
    if (merged.has(key) || !("path" in ref)) continue;
    const candidate = resolve(root, ref.path);
    if (!candidate.startsWith(root + sep)) continue;
    try {
      const target = await realpath(candidate);
      if (!target.startsWith(root + sep)) continue;
      const bytes = await readFile(target);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      merged.set(key, copy);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EISDIR" && code !== "ENOTDIR")
        throw error;
    }
  }
  return merged;
}

export async function writeDeckToWorkspace(
  workspace: string,
  deckInput: unknown,
  assets?: Assets,
) {
  const validated = validateDeck(deckInput);
  if (!validated.ok) throw new DeckError(validated.issues);
  const { deck } = validated;
  const resolvedAssets = await resolveWorkspaceAssets(workspace, deck, assets);
  const issues = checkDeck(deck, resolvedAssets);

  if (issues.length > 0) {
    await rm(join(workspace, DECK_JSON), { force: true });
    await rm(join(workspace, DECK_PPTX), { force: true });
    await rm(join(workspace, DECK_PDF), { force: true });
    await rm(join(workspace, DECK_CHECK_PATH), { force: true });
    return {
      deck,
      slideCount: deck.slides.length,
      pptxBytes: 0,
      pdfBytes: 0,
      passed: false,
      issues,
    };
  }
  const jsonTarget = join(workspace, DECK_JSON);
  await mkdir(dirname(jsonTarget), { recursive: true });
  await writeFile(jsonTarget, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  const pptx = await writePptx(deck, resolvedAssets);
  const pdf = writeDeckPdf(deck, resolvedAssets);
  await writeFile(join(workspace, DECK_PPTX), pptx);
  await writeFile(join(workspace, DECK_PDF), pdf);

  return {
    deck,
    slideCount: deck.slides.length,
    pptxBytes: pptx.byteLength,
    pdfBytes: pdf.byteLength,
    passed: true,
    issues,
  };
}

export async function checkDeckInWorkspace(
  workspace: string,
  optionsOrAssets?: Assets | DeckToolsOptions,
) {
  const { assets, onDeckChecked } = normalizeDeckToolsOptions(optionsOrAssets);
  const raw = await readFile(join(workspace, DECK_JSON), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const validated = validateDeck(parsed);
  if (!validated.ok) {
    return {
      passed: false,
      issues: validated.issues,
    };
  }
  const resolvedAssets = await resolveWorkspaceAssets(
    workspace,
    validated.deck,
    assets,
  );
  const issues = checkDeck(validated.deck, resolvedAssets);
  const passed = issues.length === 0;
  if (passed && onDeckChecked) {
    const jsonBytes = new TextEncoder().encode(raw);
    const pptxBytes =
      (await readExistingBytes(join(workspace, DECK_PPTX))) ??
      (await writePptx(validated.deck, resolvedAssets));
    const pdfBytes =
      (await readExistingBytes(join(workspace, DECK_PDF))) ??
      writeDeckPdf(validated.deck, resolvedAssets);
    await onDeckChecked({
      deck: validated.deck,
      jsonBytes,
      pptxBytes,
      pdfBytes,
      sha256: sha256Hex(jsonBytes),
      pptxSha256: sha256Hex(pptxBytes),
      pdfSha256: sha256Hex(pdfBytes),
    });
  }
  return {
    passed,
    issues,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorIssues(path: string, error: unknown): DeckIssue[] {
  if (error instanceof DeckError) return error.issues;
  return [
    {
      path,
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

export function createDeckTools(optionsOrAssets?: Assets | DeckToolsOptions) {
  const { assets, onDeckChecked } = normalizeDeckToolsOptions(optionsOrAssets);
  const definitions = [
    {
      name: "write_deck",
      description:
        "Validate, check and render a slide deck to .builder/deck.json, .builder/deck.pptx and .builder/deck.pdf in the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          deck: {
            ...Deck.toJsonSchema({
              fallback: { default: (ctx) => ctx.base },
            }),
          },
        },
        required: ["deck"],
        additionalProperties: false,
      },
    },
    {
      name: "check_deck",
      description:
        "Check .builder/deck.json in the workspace for empty placeholders, text overflow, broken images and low contrast.",
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
        if (call.name === "write_deck") {
          const deckArg =
            isObjectRecord(call.arguments) && "deck" in call.arguments
              ? call.arguments.deck
              : call.arguments;
          try {
            const written = await writeDeckToWorkspace(
              env.toolCwd,
              deckArg,
              assets,
            );
            return {
              callId: call.id,
              content: JSON.stringify({
                slideCount: written.slideCount,
                pptxBytes: written.pptxBytes,
                pdfBytes: written.pdfBytes,
                passed: written.passed,
                issues: written.issues,
              }),
              ...(written.passed ? {} : { isError: true }),
            };
          } catch (error) {
            return {
              callId: call.id,
              content: JSON.stringify({
                passed: false,
                issues: errorIssues("deck", error),
              }),
              isError: true,
            };
          }
        }

        if (call.name === "check_deck") {
          try {
            const checked = await checkDeckInWorkspace(env.toolCwd, {
              ...(assets ? { assets } : {}),
              ...(onDeckChecked ? { onDeckChecked } : {}),
            });
            return {
              callId: call.id,
              content: JSON.stringify(checked),
              ...(checked.passed ? {} : { isError: true }),
            };
          } catch (error) {
            return {
              callId: call.id,
              content: JSON.stringify({
                passed: false,
                issues: errorIssues(DECK_JSON, error),
              }),
              isError: true,
            };
          }
        }

        return {
          callId: call.id,
          content: "unknown_deck_tool",
          isError: true,
        };
      },
    }),
  });
}
