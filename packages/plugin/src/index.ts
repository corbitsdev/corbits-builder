import { type, type ArkErrors, type Type } from "arktype";

// Something true of the project, such as "fonts_chosen".
export type Fact = string;

// The `builder` block of a plugin's package.json: what the coordinator searches and reads.
export const Builder = type({
  handle: "string > 0",
  runs: "string > 0",
  groups: "string[] > 0",
  when: "string > 0",
  unless: "string > 0",
  "screen?": "string > 0",
  "data?": "string > 0",
  "returns?": { fact: "string > 0" },
  "authorizes?": "boolean",
  // Project values, by their registered names, that Builder supplies to the screen and saves from its output.
  "reads?": "string[]",
  "writes?": "string[]",
  // How a person would ask for it, in their words.
  "examples?": "string[]",
  "triggers?": "string[]",
});
export type Builder = typeof Builder.infer;

export type Refusal = {
  field: string;
  problem: string;
  choices?: Record<string, string>;
  // The sentence after the choices, for a field that also takes something besides them.
  otherwise?: string;
  next: string;
};

export class RefusalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(`${refusal.field}: ${refusal.problem}`);
  }
}

export const isRefusal = (error: unknown): error is RefusalError =>
  error instanceof RefusalError;

export function refuse(refusal: Refusal): never {
  throw new RefusalError(refusal);
}

export type Field = {
  about: string;
  choices?: Record<string, string>;
  otherwise?: string;
};

// The project's values a plugin reads, by name; undefined where the project has none yet.
export type ProjectValues = Readonly<Record<string, unknown>>;

export type Describe<Fields extends PropertyKey> = {
  summary: string;
  when: string;
  unless: string;
  fields: { [name in Fields]-?: Field };
};

export type Screen<In, Out, Data, Prepared> = {
  input: Type<In>;
  output: Type<Out>;
  data?: Type<Data>;
  prepare?: (
    input: Type<In>["infer"],
    data: Type<Data>["infer"],
    project: ProjectValues,
  ) => Prepared;
  describe: Describe<keyof Type<In>["inferIn"]>;
};

export const defineScreen = <In, Out, Data, Prepared>(
  screen: Screen<In, Out, Data, Prepared>,
) => screen;

// What the interface hands a screen's view. Plain props, so this package needs no React.
export type ScreenViewProps<Input, Output, Prepared> = {
  input: Input;
  project: ProjectValues;
  prepared: Prepared;
  facts: readonly Fact[];
  draft: Partial<Output>;
  setDraft(change: Partial<Output>): void;
  submit(output: Output): Promise<void>;
  submitting: boolean;
  answer: Output | undefined;
};

export type Refused = { ok: false; refusal: Refusal; text: string };

const refused = (
  handle: string,
  refusal: Refusal,
  input: unknown,
): Refused => ({
  ok: false,
  refusal,
  text: refusalText(handle, refusal, input),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function schemaRefusal(
  fields: Record<string, Field | undefined>,
  errors: ArkErrors,
): Refusal {
  const [first] = errors;
  const [head = "input", ...inside] = first?.path ?? [];
  const field = String(head);
  const problem = first?.problem ?? errors.summary;
  const refusal: Refusal = {
    field,
    problem: inside.length > 0 ? `${inside.join(".")} ${problem}` : problem,
    next: `Call again with the same input and ${field} corrected.`,
  };
  const described = fields[field];
  if (described?.choices) refusal.choices = described.choices;
  if (described?.otherwise) refusal.otherwise = described.otherwise;
  return refusal;
}

// Only fields with no error of their own count as fine, so the agent is never told a wrong one was.
function fineFields(raw: unknown, errors: ArkErrors) {
  if (!isRecord(raw)) return {};
  const failing = new Set(errors.map((error) => String(error.path[0])));
  return Object.fromEntries(
    Object.entries(raw).filter(([name]) => !failing.has(name)),
  );
}

export function checkInput<In, Out, Data, Prepared>(
  handle: string,
  screen: Screen<In, Out, Data, Prepared>,
  rawInput: unknown,
  data: Type<Data>["infer"],
  project: ProjectValues,
):
  | { ok: true; input: Type<In>["infer"]; prepared: Prepared | undefined }
  | Refused {
  const input = screen.input(rawInput);
  if (input instanceof type.errors)
    return refused(
      handle,
      schemaRefusal(screen.describe.fields, input),
      fineFields(rawInput, input),
    );
  try {
    return {
      ok: true,
      input,
      prepared: screen.prepare?.(input, data, project),
    };
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return refused(handle, error.refusal, input);
  }
}

export function checkOutput<In, Out, Data, Prepared>(
  handle: string,
  screen: Screen<In, Out, Data, Prepared>,
  rawOutput: unknown,
): { ok: true; output: Type<Out>["infer"] } | Refused {
  const output = screen.output(rawOutput);
  if (output instanceof type.errors)
    return refused(
      handle,
      schemaRefusal({}, output),
      fineFields(rawOutput, output),
    );
  return { ok: true, output };
}

function columns(rows: Record<string, string>, indent: string) {
  const width = Math.max(...Object.keys(rows).map((name) => name.length)) + 2;
  return Object.entries(rows).map(
    ([name, about]) => `${indent}${name.padEnd(width)}${about}`,
  );
}

export function guidanceText<In, Out, Data, Prepared>(
  handle: string,
  screen: Screen<In, Out, Data, Prepared>,
  reads: readonly string[],
) {
  const { summary, when, unless, fields } = screen.describe;
  const lines = [
    `${handle}: ${summary}`,
    `Use it when: ${when}`,
    `Not when: ${unless}`,
  ];
  if (reads.length > 0)
    lines.push(
      `Builder gives the screen the project's ${reads.join(", ")} itself; do not pass them.`,
    );
  lines.push("", "Input:");
  const entries: [string, Field][] = Object.entries(fields);
  const width = Math.max(...entries.map(([name]) => name.length)) + 2;
  for (const [name, field] of entries) {
    lines.push(`  ${name.padEnd(width)}${field.about}`);
    if (field.choices) lines.push(...columns(field.choices, "    "));
    if (field.otherwise) lines.push(`    ${field.otherwise}`);
  }
  return lines.join("\n");
}

export function refusalText(handle: string, refusal: Refusal, input: unknown) {
  const lines = [
    `${handle} was not shown. One field is wrong.`,
    "",
    `${refusal.field}: ${refusal.problem}`,
  ];
  if (refusal.choices)
    lines.push("  Use one of:", ...columns(refusal.choices, "    "));
  if (refusal.otherwise) lines.push(`  ${refusal.otherwise}`);
  lines.push("");
  const fine = Object.entries(isRecord(input) ? input : {})
    .filter(([name]) => name !== refusal.field)
    .map(([name, value]) => `${name} ${JSON.stringify(value)}`);
  if (fine.length > 0)
    lines.push(`Your other fields were fine: ${fine.join(", ")}.`);
  lines.push(refusal.next);
  return lines.join("\n");
}
