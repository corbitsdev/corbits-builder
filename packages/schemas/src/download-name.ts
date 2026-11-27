// The name a download is saved and unpacked under: the app's zip and its one top directory, a
// project export, an approval package, a document or design a pane gives away. The hub and the
// interface both name files with it, so a person's system meets one rule.

// The longest name, in UTF-8 bytes, before what follows it (`-<version>.zip`, the ` (2)` a
// browser adds to a repeat). Counted in bytes so a title in any script stays far under the 255
// bytes macOS, Linux and Windows allow one path component, and short enough to read in a list.
export const DOWNLOAD_NAME_BYTES = 64;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// Separators, controls and the characters Windows refuses become one hyphen; a run of dots would
// read as a climb out of the directory.
const clean = (part: string) =>
  part.replace(/[\p{Cc}\\/:*?"<>|\s]+/gu, "-").replace(/\.{2,}/g, "-");

// A leading dot hides the name, and Windows cannot create one that ends in a dot or a space.
const trim = (part: string) =>
  part.replace(/^[.-]+/, "").replace(/[.\s-]+$/, "");

// Whole characters within the budget, back to the last word break when one is in the second half,
// so a long title loses whole words rather than ending mid-word.
function cut(part: string, budget: number) {
  if (byteLength(part) <= budget) return part;
  let kept = "";
  for (const { segment } of graphemes.segment(part)) {
    if (byteLength(kept + segment) > budget) break;
    kept += segment;
  }
  if (part[kept.length] === "-") return kept;
  const word = kept.lastIndexOf("-");
  return word > kept.length / 2 ? kept.slice(0, word) : kept;
}

/**
 * `title` and the `kept` parts after it, joined by hyphens, within DOWNLOAD_NAME_BYTES. The parts
 * keep their room from the last back, so what tells two downloads of a project apart (a
 * document's name, its version) stays whole and the title is what shrinks. `fallback` stands in
 * for a title that leaves nothing.
 */
export function downloadName(
  title: string,
  kept: readonly string[] = [],
  fallback = "app",
): string {
  const parts = [trim(clean(title)) || fallback, ...kept.map(clean)];
  let budget = DOWNLOAD_NAME_BYTES;
  const named: string[] = [];
  for (const part of [...parts].reverse()) {
    const piece = trim(cut(trim(part), budget));
    if (piece === "") continue;
    named.unshift(piece);
    budget -= byteLength(piece) + 1;
  }
  return named.join("-") || fallback;
}
