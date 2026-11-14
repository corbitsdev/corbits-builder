import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const variants = [
  { name: "desktop-light", width: 1440, height: 1000, mode: "light" },
  { name: "desktop-dark", width: 1440, height: 1000, mode: "dark" },
  { name: "mobile-light", width: 390, height: 844, mode: "light" },
  { name: "mobile-dark", width: 390, height: 844, mode: "dark" },
] as const;

export type Capture = { id: string; variant: string; file: string };
export type Pair = {
  id: string;
  variant: string;
  status: "added" | "removed" | "changed" | "unchanged";
  before: string | null;
  after: string | null;
  diff: string | null;
  pixels: number;
};
export type Report = {
  base: string;
  head: string;
  seconds: number;
  browser: string;
  pairs: Pair[];
};

export function compare(before: Buffer, after: Buffer) {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const left = new PNG({ width, height, fill: true });
  const right = new PNG({ width, height, fill: true });
  PNG.bitblt(a, left, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, right, 0, 0, b.width, b.height, 0, 0);
  const diff = new PNG({ width, height });
  const pixels = pixelmatch(left.data, right.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
    diffColor: [255, 0, 80],
  });
  return { pixels, image: PNG.sync.write(diff) };
}

export async function pairCaptures(
  directory: string,
  before: Capture[],
  after: Capture[],
) {
  const key = (capture: Capture) => `${capture.id}/${capture.variant}`;
  const left = new Map(before.map((capture) => [key(capture), capture]));
  const right = new Map(after.map((capture) => [key(capture), capture]));
  const pairs: Pair[] = [];
  await mkdir(join(directory, "diff"), { recursive: true });
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(id);
    const b = right.get(id);
    const capture = a ?? b;
    if (!capture) throw new Error(`Missing capture: ${id}`);
    const pair: Pair = {
      id: capture.id,
      variant: capture.variant,
      status: a ? "removed" : "added",
      before: a ? a.file : null,
      after: b ? b.file : null,
      diff: null,
      pixels: 0,
    };
    if (a && b) {
      const result = compare(
        Buffer.from(await Bun.file(join(directory, a.file)).arrayBuffer()),
        Buffer.from(await Bun.file(join(directory, b.file)).arrayBuffer()),
      );
      pair.pixels = result.pixels;
      pair.status = result.pixels > 0 ? "changed" : "unchanged";
      if (pair.status === "changed") {
        pair.diff = `diff/${capture.id}-${capture.variant}.png`;
        await Bun.write(join(directory, pair.diff), result.image);
      }
    }
    pairs.push(pair);
  }
  return pairs;
}

export function markdown(report: Report, imageRoot = ".", changedOnly = false) {
  const lines = [
    "<!-- builder-visual-evidence -->",
    "## UI visual evidence",
    "",
    `Base: \`${report.base}\``,
    `Proposed: \`${report.head}\``,
    "",
    `Capture and comparison: ${report.seconds.toFixed(1)} seconds. Browser: ${report.browser}.`,
    "",
    "Pixel changes are evidence for review, not an approval gate.",
    "",
  ];
  const counts = report.pairs.reduce(
    (result, pair) => {
      result[pair.status]++;
      return result;
    },
    { added: 0, removed: 0, changed: 0, unchanged: 0 },
  );
  lines.push(
    `${counts.changed} changed, ${counts.added} added, ${counts.removed} removed, ${counts.unchanged} unchanged captures.`,
    "",
  );
  for (const pair of report.pairs) {
    if (changedOnly && pair.status === "unchanged") continue;
    lines.push(
      `### ${pair.id} / ${pair.variant} — ${pair.status}`,
      "",
      "| Before | After | Difference |",
      "| --- | --- | --- |",
    );
    const image = (path: string | null, label: string) =>
      path ? `![${label}](${imageRoot}/${path})` : "—";
    lines.push(
      `| ${image(pair.before, "Before")} | ${image(pair.after, "After")} | ${image(pair.diff, "Highlighted difference")} |`,
      "",
    );
  }
  return lines.join("\n");
}

export function html(report: Report) {
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const image = (path: string | null, label: string) =>
    path
      ? `<a href="${escape(path)}"><img loading="lazy" src="${escape(path)}" alt="${label}"></a>`
      : "—";
  const sections = report.pairs.map(
    (pair) =>
      `<details ${pair.status === "unchanged" ? "" : "open"}><summary>${escape(pair.id)} / ${escape(pair.variant)} — ${pair.status} (${pair.pixels} differing pixels)</summary><div class="pair"><figure><figcaption>Before</figcaption>${image(pair.before, "Before")}</figure><figure><figcaption>After</figcaption>${image(pair.after, "After")}</figure><figure><figcaption>Highlighted difference</figcaption>${image(pair.diff, "Difference")}</figure></div></details>`,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'"><title>Builder UI visual evidence</title><style>body{font:16px system-ui;margin:24px;color:#222;background:#fff}code{overflow-wrap:anywhere}details{border-top:1px solid #ccc;padding:16px 0}summary{cursor:pointer}.pair{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:12px 0}figcaption{font-weight:bold;margin-bottom:8px}img{width:100%;border:1px solid #ddd}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body><h1>UI visual evidence</h1><p>Base: <code>${escape(report.base)}</code><br>Proposed: <code>${escape(report.head)}</code></p><p>${report.pairs.length} captures · ${report.seconds.toFixed(1)} seconds for capture and comparison · Chromium ${escape(report.browser)}</p><p>Pixel changes are evidence for human review, not an approval gate. Unchanged captures are collapsed. Click an image to inspect it at full size.</p>${sections.join("\n")}</body></html>`;
}
