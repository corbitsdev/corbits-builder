import type { Plugin } from "../catalog.ts";

// A search: the plugins that fit what the person asked, best first. A plugin it leaves out was not found.
export type Strategy = (
  query: string,
  plugins: readonly Plugin[],
) => { handle: string; score: number }[];

// Ties keep catalog order; a plugin that scores nothing is left out.
export const byScore = (
  plugins: readonly Plugin[],
  score: (plugin: Plugin) => number,
) =>
  plugins
    .map((plugin) => ({ handle: plugin.builder.handle, score: score(plugin) }))
    .filter((ranked) => ranked.score > 0)
    .sort((left, right) => right.score - left.score);

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "is",
  "it",
  "of",
  "or",
  "to",
  "for",
  "in",
  "on",
  "my",
  "this",
  "that",
  "with",
  "be",
  "are",
]);
const BRITISH: Record<string, string> = {
  centre: "center",
  grey: "gray",
  catalogue: "catalog",
  programme: "program",
  theatre: "theater",
};

// Crude ending trimming so "fonts", "typefaces" and "coloured" meet "font", "typeface" and "color".
function stem(raw: string) {
  if (raw.length <= 3) return raw;
  let word = BRITISH[raw] ?? raw;
  if (word.length > 5)
    word = word
      .replace(/our(s|ed|ing|ful)?$/, "or$1")
      .replace(/is(e|ed|es|ing|ation)$/, "iz$1");
  if (word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
  else if (word.endsWith("sses")) word = word.slice(0, -2);
  else if (/[^su]s$/.test(word)) word = word.slice(0, -1);
  if (word.length > 5 && word.endsWith("ing")) word = word.slice(0, -3);
  else if (word.length > 4 && word.endsWith("ed")) word = word.slice(0, -2);
  if (/([bdfgklmnprt])\1$/.test(word)) word = word.slice(0, -1);
  if (word.length > 3 && word.endsWith("e")) word = word.slice(0, -1);
  return word;
}

// The words of a text, lower-cased and trimmed, with common words dropped.
export const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((word) => !STOPWORDS.has(word))
      .map(stem),
  );
