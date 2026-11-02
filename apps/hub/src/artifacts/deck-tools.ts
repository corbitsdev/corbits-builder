import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  Deck,
  DeckError,
  assetKey,
  checkDeck,
  freeElements,
  validateDeck,
  writeDeckPdf,
  writePptx,
  type AssetRef,
  type Assets,
  type Deck as DeckType,
  type DeckIssue,
} from "@corbits/slidedeck";
import { defineTool, type BaseEnv } from "@intx/agent/authoring";

interface DeckToolEnv extends BaseEnv {
  toolCwd: string;
}

export const DECK_JSON = ".builder/deck.json";
export const DECK_PPTX = ".builder/deck.pptx";
export const DECK_PDF = ".builder/deck.pdf";

function collectPathAssets(deck: DeckType): AssetRef[] {
  const refs: AssetRef[] = [];
  if (deck.theme.logo) refs.push(deck.theme.logo);
  for (const slide of deck.slides) {
    if (slide.layout === "image") refs.push(slide.image);
    if (slide.layout === "content" || slide.layout === "blank") {
      for (const block of slide.body)
        if (block.type === "image") refs.push(block.image);
    } else if (slide.layout === "two-column") {
      for (const block of [...slide.left, ...slide.right])
        if (block.type === "image") refs.push(block.image);
    } else if (slide.layout === "comparison") {
      for (const block of [...slide.left.body, ...slide.right.body])
        if (block.type === "image") refs.push(block.image);
    } else if (slide.layout === "free") {
      for (const [el] of freeElements(slide.elements, [])) {
        if (el.type === "image") {
          refs.push(el.image);
          if (el.svg) refs.push(el.svg);
        }
      }
    }
  }
  return refs;
}

async function resolveWorkspaceAssets(
  workspace: string,
  deck: DeckType,
  provided?: Assets,
): Promise<Assets> {
  const merged = new Map<string, Uint8Array<ArrayBuffer>>(provided);
  const root = resolve(workspace);
  for (const ref of collectPathAssets(deck)) {
    const key = assetKey(ref);
    if (merged.has(key) || !("path" in ref)) continue;
    const target = resolve(root, ref.path);
    if (!target.startsWith(root + sep)) continue;
    try {
      const bytes = await readFile(target);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      merged.set(key, copy);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
  const pptx = await writePptx(deck, resolvedAssets);
  const pdf = writeDeckPdf(deck, resolvedAssets);

  const jsonTarget = join(workspace, DECK_JSON);
  await mkdir(dirname(jsonTarget), { recursive: true });
  await writeFile(jsonTarget, `${JSON.stringify(deck, null, 2)}\n`, "utf8");
  await writeFile(join(workspace, DECK_PPTX), pptx);
  await writeFile(join(workspace, DECK_PDF), pdf);

  return {
    deck,
    slideCount: deck.slides.length,
    pptxBytes: pptx.byteLength,
    pdfBytes: pdf.byteLength,
    passed: issues.length === 0,
    issues,
  };
}

export async function checkDeckInWorkspace(workspace: string, assets?: Assets) {
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
  return {
    passed: issues.length === 0,
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

export function createDeckTools(assets?: Assets) {
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
            const checked = await checkDeckInWorkspace(env.toolCwd, assets);
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
