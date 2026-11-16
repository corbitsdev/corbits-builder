import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  DeckError,
  assetKey,
  assetUses,
  checkDeck,
  validateDeck,
  writeDeckPdf,
  writePptx,
  type Assets,
  type Deck as SlideDeck,
} from "@corbits/slidedeck";

export const DECK_JSON = ".builder/deck.json";
export const DECK_PPTX = ".builder/deck.pptx";
export const DECK_PDF = ".builder/deck.pdf";
const DECK_CHECK_PATH = ".builder/deck-check.json";

async function resolveWorkspaceAssets(
  workspace: string,
  deck: SlideDeck,
): Promise<Assets> {
  const merged = new Map<string, Uint8Array<ArrayBuffer>>();
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
) {
  const validated = validateDeck(deckInput);
  if (!validated.ok) throw new DeckError(validated.issues);
  const { deck } = validated;
  const resolvedAssets = await resolveWorkspaceAssets(workspace, deck);
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

export async function checkDeckInWorkspace(workspace: string) {
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
  );
  const issues = checkDeck(validated.deck, resolvedAssets);
  const passed = issues.length === 0;
  return {
    passed,
    issues,
  };
}
