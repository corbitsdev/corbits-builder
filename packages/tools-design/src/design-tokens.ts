import { COMMENT, RULE } from "./design-tweaks.ts";

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n+/;
const COLOR =
  /^(?:#[\da-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent|white|black)$/i;
const DIMENSION = /^(-?\d*\.?\d+)(px|rem)$/;
// The mockup leaves the root font size at the CSS initial value, so 1rem is 16px.
const PX_PER_REM = 16;

function declarations(css: string, selector: string) {
  for (const [, prelude = "", body = ""] of css.matchAll(RULE)) {
    if (prelude.replace(COMMENT, "").split(/[;}]/).at(-1)?.trim() !== selector)
      continue;
    const tokens = new Map<string, string>();
    for (const part of body.replace(COMMENT, "").split(";")) {
      const match = /^\s*--([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
      if (match?.[1] && match[2]) tokens.set(match[1], match[2]);
    }
    return tokens;
  }
  throw new Error(`styles.css has no ${selector} rule`);
}

function resolve(
  value: string,
  scheme: ReadonlyMap<string, string>,
  depth = 0,
): string {
  if (depth > 8)
    throw new Error(
      `styles.css: var() references in "${value}" do not resolve`,
    );
  return value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
    const referenced = scheme.get(name);
    if (referenced === undefined)
      throw new Error(`styles.css: --${name} is not defined`);
    return resolve(referenced, scheme, depth + 1);
  });
}

function dimension(name: string, value: string) {
  if (value === "0") return "0px";
  if (DIMENSION.test(value)) return value;
  const sum = /^calc\((.+)\)$/.exec(value)?.[1];
  const terms = sum?.split(/\s+(?=[+-]\s)/);
  if (!terms)
    throw new Error(
      `styles.css: --${name} is not a px or rem dimension: ${value}`,
    );
  let px = 0;
  for (const term of terms) {
    const [, sign, amount = "", unit] =
      /^([+-]?)\s*(\d*\.?\d+)(px|rem)$/.exec(term.trim()) ?? [];
    if (!unit)
      throw new Error(
        `styles.css: --${name} is not a px or rem dimension: ${value}`,
      );
    px +=
      (sign === "-" ? -1 : 1) *
      Number(amount) *
      (unit === "rem" ? PX_PER_REM : 1);
  }
  return `${px}px`;
}

const yamlMap = (indent: string, entries: Iterable<[string, string]>) =>
  [...entries].map(
    ([key, value]) => `${indent}${key}: ${JSON.stringify(value)}`,
  );

/**
 * Puts styles.css's tokens on DESIGN.md as design.md YAML front matter, replacing any there: the
 * name from the first `# ` heading, colors from :root (and .dark as dark-<token>), rounded from
 * --radius*, and typography from --font-*. Keys are the stylesheet's custom property names.
 */
export function withDesignTokens(design: string, css: string): string {
  const body = design.replace(FRONT_MATTER, "");
  const name = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!name)
    throw new Error("DESIGN.md has no `# ` heading to name the design");
  const light = declarations(css, ":root");
  const darkOwn = declarations(css, ".dark");
  const dark = new Map([...light, ...darkOwn]);
  const colors = (
    scheme: ReadonlyMap<string, string>,
    own: ReadonlyMap<string, string>,
    prefix: string,
  ) =>
    [...own].flatMap(([key, raw]): [string, string][] => {
      if (/^(?:radius|font|shadow|ease|duration)(?:-|$)/.test(key)) return [];
      const value = resolve(raw, scheme);
      return COLOR.test(value) ? [[prefix + key, value]] : [];
    });
  const colorTokens = [
    ...colors(light, light, ""),
    ...colors(dark, darkOwn, "dark-"),
  ];
  if (!colorTokens.length)
    throw new Error("styles.css :root has no color tokens");
  const tokens = [...light].map(([key, raw]): [string, string] => [
    key,
    resolve(raw, light),
  ]);
  const rounded = tokens
    .filter(([key]) => /^radius(?:-|$)/.test(key))
    .map(([key, value]): [string, string] => [key, dimension(key, value)]);
  const fonts = tokens.filter(([key]) => key.startsWith("font-"));
  if (!rounded.length)
    throw new Error("styles.css :root has no --radius token");
  if (!fonts.length) throw new Error("styles.css :root has no --font-* token");
  const front = [
    "---",
    `name: ${JSON.stringify(name)}`,
    "colors:",
    ...yamlMap("  ", colorTokens),
    "typography:",
    ...fonts.flatMap(([key, family]) => [
      `  ${key}:`,
      ...yamlMap("    ", [["fontFamily", family]]),
    ]),
    "rounded:",
    ...yamlMap("  ", rounded),
    "---",
  ];
  return `${front.join("\n")}\n\n${body}`;
}
