// The mockup's stylesheet as the designer keys it in .builder and the design bundle keys it.
export const DESIGN_STYLES = "designs/styles.css";

export const COMMENT = /\/\*[\s\S]*?\*\//g;
// Each innermost rule: its prelude back to the previous brace, and its body.
export const RULE = /([^{}]*)\{([^{}]*)\}/g;
const LIGHT_SELECTORS = new Set([":root"]);
// The system-dark rule only appears inside @media (prefers-color-scheme: dark).
const DARK_SELECTORS = new Set([".dark", ":root:not(.dark):not(.light)"]);
// The background is a light-scheme tone, so dark keeps its own, as the live preview does.
const LIGHT_ONLY = new Set(["background"]);

// An existing declaration keeps its place and gets the new value; a missing one is added last.
function setDeclarations(
  body: string,
  tokens: Readonly<Record<string, string>>,
) {
  let next = body;
  for (const [name, value] of Object.entries(tokens)) {
    const declaration = new RegExp(
      `${COMMENT.source}|(?<![\\w-])(--${name}\\s*:)[^;]*?(?=\\s*(?:;|$))`,
      "g",
    );
    let found = false;
    next = next.replace(declaration, (match, property?: string) => {
      if (property === undefined || found) return match;
      found = true;
      return `${property} ${value}`;
    });
    if (!found) {
      const trimmed = next.trimEnd();
      const separator = trimmed === "" || trimmed.endsWith(";") ? "" : ";";
      next = `${trimmed}${separator}\n  --${name}: ${value};\n`;
    }
  }
  return next;
}

/**
 * Sets each custom property as the live preview applies it: every token in each :root rule (one
 * is put first when there is none) and all but the light-only ones in each .dark and system-dark
 * rule. Token names are the contract's fixed keys.
 */
export function setThemeTokens(
  css: string,
  tokens: Readonly<Record<string, string>>,
): string {
  const dark = Object.fromEntries(
    Object.entries(tokens).filter(([name]) => !LIGHT_ONLY.has(name)),
  );
  let hasRoot = false;
  const next = css.replace(RULE, (rule, prelude: string, body: string) => {
    const selector =
      prelude.replace(COMMENT, "").split(";").at(-1)?.trim() ?? "";
    const scheme = LIGHT_SELECTORS.has(selector)
      ? tokens
      : DARK_SELECTORS.has(selector)
        ? dark
        : undefined;
    if (selector === ":root") hasRoot = true;
    return scheme ? `${prelude}{${setDeclarations(body, scheme)}}` : rule;
  });
  return hasRoot ? next : `:root {${setDeclarations("", tokens)}}\n${next}`;
}
