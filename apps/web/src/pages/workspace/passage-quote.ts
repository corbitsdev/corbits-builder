/** How a passage quoted from a document reads in a message: the document, the version and the words. */

export type PassageQuote = {
  quote: string;
  version: number;
  title: string;
};

const QUOTE_LIMIT = 600;

export function formatPassageQuote(passage: PassageQuote): string {
  const quote = passage.quote.replace(/\s+/g, " ").trim().slice(0, QUOTE_LIMIT);
  return `On "${passage.title}" v${String(passage.version)}:\n\n> ${quote}\n\n`;
}
