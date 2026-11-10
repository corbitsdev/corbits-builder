/**
 * A mockup's look as a few values a person can change: its own, read from the design's stylesheet,
 * and the tweaks over it as the custom properties and stylesheet that apply them.
 */
import type { DesignFiles } from "./design-bundle.ts";

export type LookTweaks = {
  primary?: string;
  background?: string;
  /** Corner radius in rem. */
  radius?: number;
  font?: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

const token = (css: string, name: string) =>
  new RegExp(`--${name}\\s*:\\s*([^;}]+)`).exec(css)?.[1]?.trim();

function remOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = /^([\d.]+)(rem|px)$/.exec(value);
  if (match === null) return undefined;
  const size = Number(match[1]);
  return match[2] === "px" ? size / 16 : size;
}

/** The mockup's own light-scheme tokens, read from the first stylesheet that declares them. */
export function mockupLook(files: DesignFiles): LookTweaks {
  const css = Object.entries(files)
    .filter(([path]) => path.startsWith("designs/") && path.endsWith(".css"))
    .map(([, text]) => text)
    .join("\n");
  const primary = token(css, "primary");
  const background = token(css, "background");
  const radius = remOf(token(css, "radius"));
  const font = token(css, "font-sans");
  return {
    ...(primary !== undefined && HEX.test(primary) ? { primary } : {}),
    ...(background !== undefined && HEX.test(background) ? { background } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...(font === undefined ? {} : { font }),
  };
}

function readableOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(
    (at) => parseInt(hex.slice(at, at + 2), 16) / 255,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#1a1718" : "#ffffff";
}

const cssValue = (value: string) => value.replace(/[<>{};]/g, "");

/** The custom properties a look sets, keyed without their leading dashes. */
export function lookTokens(tweaks: LookTweaks): Record<string, string> {
  const tokens: Record<string, string> = {};
  if (tweaks.primary !== undefined) {
    const primary = cssValue(tweaks.primary);
    tokens["primary"] = primary;
    tokens["primary-foreground"] = readableOn(primary);
    tokens["primary-active"] = `color-mix(in srgb,${primary} 85%,black)`;
    tokens["ring"] = `color-mix(in srgb,${primary} 70%,black)`;
  }
  if (tweaks.background !== undefined)
    tokens["background"] = cssValue(tweaks.background);
  if (tweaks.radius !== undefined)
    tokens["radius"] = `${String(tweaks.radius)}rem`;
  if (tweaks.font !== undefined) tokens["font-sans"] = cssValue(tweaks.font);
  return tokens;
}

/**
 * Doubled selectors outrank the stylesheet's own :root and .dark blocks wherever this lands in
 * the page; the background is a light-scheme tone, so dark keeps its own.
 */
export function tweakCss(tweaks: LookTweaks): string {
  const { background, ...shared } = lookTokens(tweaks);
  const declarations = Object.entries(shared).map(
    ([name, value]) => `--${name}:${value}`,
  );
  const rules =
    declarations.length === 0
      ? []
      : [`:root:root,.dark.dark{${declarations.join(";")}}`];
  if (background !== undefined)
    rules.push(`:root:root:not(.dark){--background:${background}}`);
  return rules.join("");
}
