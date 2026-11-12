import { type } from "arktype";
import type { ValueDeclaration } from "@corbits-builder/plugin";
import type { DesignTweaks } from "@corbits-builder/schemas/artifact";
import { ProjectError, typeIssues } from "../projects/errors.ts";
import { declarations } from "./design-tokens.ts";

// What the project has stored that its values are read from: the filed design's styles.css, and
// the project's plain store of every other value by name.
export type ProjectState = {
  styles: string | undefined;
  stored: Readonly<Record<string, unknown>>;
};

type FontToken = Extract<keyof DesignTweaks["tokens"], `font-${string}`>;

// The families a :root font token lists, in order and as written, quotes kept.
function families(state: ProjectState, token: FontToken) {
  if (state.styles === undefined) return [];
  const list = declarations(state.styles, ":root").get(token) ?? "";
  return list
    .split(",")
    .map((family) => family.trim())
    .filter((family) => family !== "");
}

function fontValue(name: string, about: string, token: FontToken) {
  return {
    name,
    about,
    schema: type("string > 0"),
    read: (state: ProjectState) =>
      families(state, token)[0]?.replace(/^"|"$/g, ""),
    // Saved through design-tweaks as this token.
    token,
    // The chosen font leads the list and the stored fallbacks stay behind it.
    write: (value: string, state: ProjectState) =>
      [JSON.stringify(value), ...families(state, token).slice(1)].join(", "),
  };
}

// Six hex digits, as the mockup's tweak panel reads and writes these tokens; any other colour reads as none.
const HEX = type(/^#[0-9a-fA-F]{6}$/);

function colorValue(
  name: string,
  about: string,
  token: "primary" | "background",
) {
  return {
    name,
    about,
    schema: HEX,
    read: (state: ProjectState) => {
      if (state.styles === undefined) return undefined;
      const value = declarations(state.styles, ":root").get(token);
      return HEX.allows(value) ? value : undefined;
    },
    // Saved through design-tweaks as this token.
    token,
    write: (value: string) => value,
  };
}

// The values whose home is the design's tokens; every other value lives in the plain store.
export const TOKEN_VALUES = [
  fontValue(
    "look.font-primary",
    "The font for headings and text.",
    "font-sans",
  ),
  fontValue(
    "look.font-secondary",
    "The font for code and figures.",
    "font-mono",
  ),
  colorValue(
    "look.color-primary",
    "The brand colour of buttons and links.",
    "primary",
  ),
  colorValue(
    "look.color-background",
    "The page colour behind everything.",
    "background",
  ),
] as const;

/** The token values as the catalog declares them. */
export const TOKEN_DECLARATIONS: Readonly<Record<string, ValueDeclaration>> =
  Object.fromEntries(
    TOKEN_VALUES.map(({ name, about }) => [name, { about, type: "text" }]),
  );

const tokenValue = (name: string) =>
  TOKEN_VALUES.find((value) => value.name === name);

const STORED_TYPES = {
  text: type("string"),
  json: type("unknown"),
} as const;

const invalid = (key: string, issues: type.errors) =>
  new ProjectError(400, "invalid_project_value", {
    key,
    issues: typeIssues(issues, key),
  });

/**
 * Each named value split by its home: design tokens written over the project's current state, and
 * the plain store. Every name must be one the catalog declares.
 */
export function projectValueWrites(
  values: Readonly<Record<string, unknown>>,
  state: ProjectState,
  declared: ReadonlyMap<string, ValueDeclaration>,
) {
  const tokens: Record<string, string> = {};
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const token = tokenValue(name);
    if (token) {
      const checked = token.schema(value);
      if (checked instanceof type.errors) throw invalid(name, checked);
      tokens[token.token] = token.write(checked, state);
      continue;
    }
    const declaration = declared.get(name);
    if (!declaration)
      throw new Error(`${name} is not a declared project value`);
    const checked = STORED_TYPES[declaration.type](value);
    if (checked instanceof type.errors) throw invalid(name, checked);
    stored[name] = checked;
  }
  return { tokens, stored };
}

/** Each named value from its home, null when the project has none. */
export function readProjectValues(
  names: readonly string[],
  state: ProjectState,
): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => {
      const token = tokenValue(name);
      if (!token) return [name, state.stored[name] ?? null];
      const value = token.read(state);
      return [name, value === undefined ? null : token.schema.assert(value)];
    }),
  );
}
