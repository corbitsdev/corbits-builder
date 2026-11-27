/** One line of a retained-version diff. Unchanged lines keep a leading space. */
export type DiffLine = { sign: " " | "+" | "-"; text: string };

/**
 * Line diff of two retained versions. Documents are capped at the artifact
 * write limit, so a straightforward longest-common-subsequence is enough
 * and does not pull in a diff package.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const older = before.replace(/\n$/, "").split("\n");
  const newer = after.replace(/\n$/, "").split("\n");
  const width = newer.length;
  const scores: number[][] = [];
  for (let row = 0; row <= older.length; row += 1) {
    scores.push(Array.from({ length: width + 1 }, () => 0));
  }
  for (let i = older.length - 1; i >= 0; i -= 1) {
    const current = scores[i];
    const below = scores[i + 1];
    if (!current || !below) continue;
    for (let j = width - 1; j >= 0; j -= 1) {
      const down = below[j] ?? 0;
      const right = current[j + 1] ?? 0;
      const diagonal = below[j + 1] ?? 0;
      current[j] = older[i] === newer[j] ? diagonal + 1 : Math.max(down, right);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < older.length && j < newer.length) {
    const left = older[i];
    const right = newer[j];
    if (left === undefined || right === undefined) break;
    if (left === right) {
      lines.push({ sign: " ", text: left });
      i += 1;
      j += 1;
      continue;
    }
    const down = scores[i + 1]?.[j] ?? 0;
    const across = scores[i]?.[j + 1] ?? 0;
    if (down >= across) {
      lines.push({ sign: "-", text: left });
      i += 1;
    } else {
      lines.push({ sign: "+", text: right });
      j += 1;
    }
  }
  for (; i < older.length; i += 1) {
    const left = older[i];
    if (left !== undefined) lines.push({ sign: "-", text: left });
  }
  for (; j < newer.length; j += 1) {
    const right = newer[j];
    if (right !== undefined) lines.push({ sign: "+", text: right });
  }
  return lines;
}
