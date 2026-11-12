import { type, type Type } from "arktype";
import {
  FileValue,
  LinkValue,
  type ValueDeclaration,
  type ValueType,
} from "@corbits-builder/plugin";
import type { DesignTweaks } from "@corbits-builder/schemas/artifact";
import { ProjectError, typeIssues } from "../projects/errors.ts";
import { declarations } from "./design-tokens.ts";

// What the project has stored that its values are read from: the filed design's styles.css, and
// the project's plain store of every other value by name. materials are the files the person
// attached, which a file value names.
export type ProjectState = {
  styles: string | undefined;
  stored: Readonly<Record<string, unknown>>;
  materials: readonly { artifactId: string; name: string }[];
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

// The look values, whose home is the filed design's tokens once a design is filed. Before that
// they live in the plain store, as every other value does, and the designer's first mockup is
// handed them.
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

const STORED_TYPES: Record<ValueType, Type<unknown>> = {
  text: type("string"),
  json: type("unknown"),
  link: LinkValue,
  file: FileValue,
};

const invalid = (key: string, issues: type.errors) =>
  new ProjectError(400, "invalid_project_value", {
    key,
    issues: typeIssues(issues, key),
  });

// The type a value's shape names: a string is text, { link } a link, { file } a file.
function shapeOf(value: unknown): ValueType {
  if (typeof value === "string") return "text";
  if (typeof value !== "object" || value === null) return "json";
  if ("link" in value) return "link";
  if ("file" in value) return "file";
  return "json";
}

// A value checked against its declared type or, of several, the one its shape names, so a refusal
// says what is wrong with it as that kind. A file is stored with the name of the material it names,
// which must be one the person attached to this project.
function storedValue(
  name: string,
  value: unknown,
  declaration: ValueDeclaration,
  state: ProjectState,
) {
  const types = [declaration.type].flat();
  const shaped = types.find((each) => each === shapeOf(value));
  const schema =
    shaped === undefined
      ? types
          .map((each) => STORED_TYPES[each])
          .reduce((one, other) => one.or(other))
      : STORED_TYPES[shaped];
  const checked = schema(value);
  if (checked instanceof type.errors) throw invalid(name, checked);
  if (!types.includes("file") || !FileValue.allows(checked)) return checked;
  const material = state.materials.find(
    ({ artifactId }) => artifactId === checked.file,
  );
  if (material === undefined)
    throw new ProjectError(400, "invalid_project_value", {
      key: name,
      issues: [
        {
          path: `${name}.file`,
          message: "is not a file attached to this project",
        },
      ],
    });
  return { file: material.artifactId, name: material.name };
}

/**
 * Each named value split by its home: design tokens written over the project's filed design, and
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
      if (state.styles === undefined) stored[name] = checked;
      else tokens[token.token] = token.write(checked, state);
      continue;
    }
    const declaration = declared.get(name);
    if (!declaration)
      throw new Error(`${name} is not a declared project value`);
    stored[name] = storedValue(name, value, declaration, state);
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
      const token = state.styles === undefined ? undefined : tokenValue(name);
      if (!token) return [name, state.stored[name] ?? null];
      const value = token.read(state);
      return [name, value === undefined ? null : token.schema.assert(value)];
    }),
  );
}
