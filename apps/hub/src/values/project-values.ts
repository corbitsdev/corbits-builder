import { type } from "arktype";
import { FileValue, type Value } from "@corbits-builder/plugin";
import { ProjectError, typeIssues } from "../projects/errors.ts";
import { declarations } from "../artifacts/design-tokens.ts";

// What the project has stored that its values are read from: the filed design's styles.css, and
// the project's plain store of every other value by name. materials are the files the person
// attached, which a file value names.
export type ProjectState = {
  styles: string | undefined;
  stored: Readonly<Record<string, unknown>>;
  materials: readonly { artifactId: string; name: string }[];
};

// A value whose home is the design's styles, as its declaration says.
type Styled = Value & { style: NonNullable<Value["style"]> };

const isStyled = (declaration: Value): declaration is Styled =>
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
  return value !== undefined && declaration.schema.allows(value)
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

const invalid = (key: string, issues: type.errors) =>
  new ProjectError(400, "invalid_project_value", {
    key,
    issues: typeIssues(issues, key),
  });

// A value checked against its declared schema. A file is stored with the name of the material it
// names, which must be one the person attached to this project.
function storedValue(
  name: string,
  value: unknown,
  declaration: Value,
  state: ProjectState,
) {
  const checked = declaration.schema(value);
  if (checked instanceof type.errors) throw invalid(name, checked);
  if (!FileValue.allows(checked)) return checked;
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
  declared: ReadonlyMap<string, Value>,
) {
  const tokens: Record<string, string> = {};
  const stored: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) {
    const declaration = declared.get(name);
    if (!declaration)
      throw new Error(`${name} is not a declared project value`);
    // null clears a value of any type, so it reads as unset again. A value in the filed design's
    // styles is that design's token, which a design can change but must always have.
    if (value === null) {
      if (state.styles !== undefined && isStyled(declaration))
        throw new ProjectError(400, "invalid_project_value", {
          key: name,
          issues: [
            {
              path: name,
              message: "is held by the filed design and cannot be cleared",
            },
          ],
        });
      stored[name] = null;
      continue;
    }
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
  declared: ReadonlyMap<string, Value>,
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
