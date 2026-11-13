import { type, type Type } from "arktype";
import {
  FileValue,
  LinkValue,
  type ValueDeclaration,
  type ValueType,
} from "@corbits-builder/plugin";
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

// A value whose home is the design's styles, as its declaration says.
type Styled = ValueDeclaration & {
  style: NonNullable<ValueDeclaration["style"]>;
};

const isStyled = (declaration: ValueDeclaration): declaration is Styled =>
  declaration.style !== undefined;

// What a styled value's token holds in the filed design's :root; for a token that lists several
// values, each in order and as written, quotes kept.
function tokenHolds(styles: string, { style }: Styled) {
  const held = declarations(styles, ":root").get(style.token) ?? "";
  if (!style.leads) return [held.trim()];
  return held
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "");
}

// A styled value as the filed design holds it: its token's value, or the one leading its list
// without quotes, when its type takes it.
function readStyled(styles: string, declaration: Styled) {
  const [held] = tokenHolds(styles, declaration);
  const value = declaration.style.leads ? held?.replace(/^"|"$/g, "") : held;
  return value !== undefined && schemaOf(declaration).allows(value)
    ? value
    : undefined;
}

// A value written into a design token may not end its declaration or rule.
const TOKEN_TEXT = type(/^[^;{}<>\\]+$/);

// A styled value as its token takes it: the value, or the value leading the list it already holds.
const writeStyled = (value: string, styles: string, declaration: Styled) =>
  declaration.style.leads
    ? [JSON.stringify(value), ...tokenHolds(styles, declaration).slice(1)].join(
        ", ",
      )
    : value;

const STORED_TYPES: Record<ValueType, Type<unknown>> = {
  text: type("string"),
  json: type("unknown"),
  link: LinkValue,
  file: FileValue,
};

// What a value of one type is checked against: text against its pattern, when it declares one.
const typeOf = (each: ValueType, declaration: ValueDeclaration) =>
  each === "text" && declaration.pattern !== undefined
    ? type(new RegExp(declaration.pattern))
    : STORED_TYPES[each];

const schemaOf = (declaration: ValueDeclaration) =>
  [declaration.type]
    .flat()
    .map((each) => typeOf(each, declaration))
    .reduce((one, other) => one.or(other));

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
    shaped === undefined ? schemaOf(declaration) : typeOf(shaped, declaration);
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
 * Each named value split by its home: the design tokens of the values whose home is the filed
 * design's styles, once there is one, and the plain store. Every name must be one the catalog
 * declares.
 */
export function projectValueWrites(
  values: Readonly<Record<string, unknown>>,
  state: ProjectState,
  declared: ReadonlyMap<string, ValueDeclaration>,
) {
  const tokens: Record<string, string> = {};
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const declaration = declared.get(name);
    if (!declaration)
      throw new Error(`${name} is not a declared project value`);
    const checked = storedValue(name, value, declaration, state);
    if (
      state.styles === undefined ||
      !isStyled(declaration) ||
      typeof checked !== "string"
    )
      stored[name] = checked;
    else {
      const written = TOKEN_TEXT(
        writeStyled(checked, state.styles, declaration),
      );
      if (written instanceof type.errors) throw invalid(name, written);
      tokens[declaration.style.token] = written;
    }
  }
  return { tokens, stored };
}

/** Each named value from its home, null when the project has none. */
export function readProjectValues(
  names: readonly string[],
  state: ProjectState,
  declared: ReadonlyMap<string, ValueDeclaration>,
): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => {
      const declaration = declared.get(name);
      if (
        state.styles === undefined ||
        declaration === undefined ||
        !isStyled(declaration)
      )
        return [name, state.stored[name] ?? null];
      return [name, readStyled(state.styles, declaration) ?? null];
    }),
  );
}
