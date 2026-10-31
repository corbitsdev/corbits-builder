const MAX_ITEMS = 4;
const MAX_LENGTH = 80;
const BULLET = /^\s*[-*+]\s+(.+?)\s*$/;

/**
 * Answer options a coordinator turn offers: a closing bullet list of 2-4 short
 * items directly under a question line. Any other list stays prose.
 */
export function suggestedReplies(text: string): string[] {
  const lines = text.trimEnd().split("\n");
  const items: string[] = [];
  let index = lines.length - 1;
  for (; index >= 0; index--) {
    const match = BULLET.exec(lines[index] ?? "");
    if (!match) break;
    items.unshift(match[1]!.replace(/\*\*|__/g, "").trim());
  }
  if (items.length < 2 || items.length > MAX_ITEMS) return [];
  if (items.some((item) => item.length === 0 || item.length > MAX_LENGTH))
    return [];
  let question = index;
  while (question >= 0 && (lines[question] ?? "").trim() === "") question--;
  const line = (lines[question] ?? "").replace(/\*\*|__/g, "").trim();
  return line.endsWith("?") ? items : [];
}
