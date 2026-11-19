import { type, type ArkErrors, type Type } from "arktype";

export type RawEnvironment = Readonly<Record<string, string | undefined>>;

export type Variable = Readonly<{ name: string; required: boolean }>;

/** A broken rule across variables, reported on the variable to change. */
export type Problem = Readonly<{ variable: string; expected: string }>;

/** Every problem the environment has, one line each, naming the variable and the rule. */
export class EnvironmentError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        "The environment is not valid:",
        ...problems.map((line) => `- ${line}`),
      ].join("\n"),
    );
    this.name = "EnvironmentError";
    this.problems = problems;
  }
}

// ArkType's summary ends each line with the refused value, which can be a secret here. Each line is
// built from the variable's name and the rule instead.
const line = ({ variable, expected }: Problem) =>
  `${variable} must be ${expected}`;

function problemsOf(errors: ArkErrors): string[] {
  return errors.map((error) => {
    const problem = line({
      variable: error.path.map(String).join("."),
      expected: error.expected,
    });
    return error.code === "required" ? `${problem} (missing)` : problem;
  });
}

/** The variables an object schema declares, by name, and whether each must be set. */
function variables(schema: Type<object>): Variable[] {
  return schema.props
    .map(({ key, kind }) => ({
      name: String(key),
      required: kind === "required",
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Returns a reader for the environment `schema` describes. It validates the whole environment, the
 * process's own by default, and throws one EnvironmentError that lists every problem. It drops
 * variables the schema does not name. Once each variable is valid, `problems` checks the rules
 * across variables, and `derive` adds values built from several.
 */
export function environment<
  const schema extends Type<object>,
  derived extends object = {},
>(
  schema: schema,
  rules: Readonly<{
    problems?: (env: schema["infer"]) => readonly Problem[];
    derive?: (env: schema["infer"]) => derived;
  }> = {},
) {
  const declared = schema.onUndeclaredKey("delete");
  const read = (
    raw: RawEnvironment = process.env,
  ): schema["infer"] & derived => {
    // Leave unset variables out rather than present as undefined.
    const env = declared(
      Object.fromEntries(
        Object.entries(raw).filter(([, value]) => value !== undefined),
      ),
    );
    if (env instanceof type.errors) throw new EnvironmentError(problemsOf(env));
    const problems = rules.problems?.(env) ?? [];
    if (problems.length) throw new EnvironmentError(problems.map(line));
    // TypeScript cannot see that `derived` stays {} whenever `derive` is left out.
    return { ...env, ...rules.derive?.(env) } as schema["infer"] & derived;
  };
  return Object.assign(read, { variables: variables(schema) });
}
