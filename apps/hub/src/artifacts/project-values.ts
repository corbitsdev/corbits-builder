import { type } from "arktype";
import type { DesignTweaks } from "@corbits-builder/schemas/artifact";
import { ProjectError } from "../projects/errors.ts";
import { declarations } from "./design-tokens.ts";

// What the project has stored that its values are read from: the filed design's styles.css.
export type ProjectState = { styles: string | undefined };

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

function fontValue(name: string, token: FontToken) {
  return {
    name,
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

function colorValue(name: string, token: "primary" | "background") {
  return {
    name,
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

// Values a plugin may declare it reads or writes, so the agent never has to supply them.
export const PROJECT_VALUES = [
  fontValue("look.font-primary", "font-sans"),
  fontValue("look.font-secondary", "font-mono"),
  colorValue("look.color-primary", "primary"),
  colorValue("look.color-background", "background"),
] as const;

/** The first name that is not a registered project value. */
export const unregisteredValue = (names: readonly string[]) =>
  names.find((name) => !PROJECT_VALUES.some((value) => value.name === name));

/** The design tokens that store each named value over the project's current state. */
export function projectValueTokens(
  values: Readonly<Record<string, string>>,
  state: ProjectState,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const entry = PROJECT_VALUES.find((known) => known.name === name);
      if (!entry) throw new Error(`${name} is not a registered project value`);
      const checked = entry.schema(value);
      if (checked instanceof type.errors)
        throw new ProjectError(400, "invalid_project_value", {
          key: name,
          issues: checked,
        });
      return [entry.token, entry.write(checked, state)];
    }),
  );
}

/** Each named value as the project stores it, null when it has none. */
export function readProjectValues(
  names: readonly string[],
  state: ProjectState,
): Record<string, string | null> {
  return Object.fromEntries(
    names.map((name) => {
      const entry = PROJECT_VALUES.find((value) => value.name === name);
      if (!entry) throw new Error(`${name} is not a registered project value`);
      const value = entry.read(state);
      return [name, value === undefined ? null : entry.schema.assert(value)];
    }),
  );
}
