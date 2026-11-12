import { type, type ArkErrors, type Type } from "arktype";
import { NativeSpecialistAssignment } from "@corbits-builder/schemas/native-specialist";

// Something true of the project that Builder works out from what it stores, such as "app_exists". A
// workflow's fact may name one of its input fields, as "filed:{kind}", for the value passed there.
export type Fact = string;

const Facts = type("string > 0").array();
// Alternatives, each the facts that together let a plugin start.
const Requires = Facts.atLeastLength(1).array().atLeastLength(1);

// A named piece of project data a plugin brings, such as "brand.guidelines": what it holds, in one
// line, and what Builder checks a saved value against. text is a string; json is any JSON value.
export const ValueDeclaration = type({
  "+": "reject",
  about: "string > 0",
  type: "'text' | 'json'",
});
export type ValueDeclaration = typeof ValueDeclaration.infer;

const Common = type({
  handle: "string > 0",
  groups: "string[] > 0",
  when: "string > 0",
  unless: "string > 0",
  // How a person would ask for it, in their words.
  "examples?": "string[]",
  "triggers?": "string[]",
  // Each fact this plugin's work is about, in plain words, as refusals and discover say it.
  "facts?": { "[string]": "string > 0" },
  // The project values this plugin brings, by namespaced name; any plugin may then read them.
  "values?": { "[string]": ValueDeclaration },
});

// One thing a specialist does, with the facts it needs to start and the facts its finished work makes.
const ActionBuilder = type({
  when: "string > 0",
  unless: "string > 0",
  "requires?": Requires,
  returns: Facts,
});

// Something put in front of the person: the coordinator opens it with question, naming the plugin
// and the action, and the person's answer is the question's result. The project values it saves
// are the ones its screen's writes maps from the answer.
export const ScreenActionBuilder = type({
  runs: "'screen'",
  when: "string > 0",
  unless: "string > 0",
  screen: "string > 0",
  // The module whose default export draws the screen in the interface.
  view: "string > 0",
  "data?": "string > 0",
  // Project values, by their registered names, that Builder supplies to the screen.
  "reads?": "string[]",
  // The facts the person's answer can make true, each recorded from what the screen's approves
  // names; a templated fact names an input field, so the person approves only what was asked.
  "returns?": Facts,
  // "page" draws the screen over the whole room with the prompt box still in reach; without it the
  // screen draws in the conversation.
  "place?": "'page'",
  // What the host itself supplies the view, by the names its registry knows: data too large or too
  // live for the input or project values, or a part only the host may draw.
  "host?": "string[]",
});
export type ScreenActionBuilder = typeof ScreenActionBuilder.infer;

// Another agent does the work in its own run.
export const WorkflowActionBuilder = ActionBuilder.merge({
  runs: "'workflow'",
  input: "string > 0",
  // The installed workflow the host starts, and what that workflow's starter takes besides the input.
  start: { workflow: "string > 0", "[string]": "unknown" },
  // Project values, by name, that Builder puts in the run's assignment.
  "reads?": "string[]",
  // Project values, by name, that the run's agent may save with report_values as it learns them.
  "writes?": "string[] > 0",
  // The screen actions of the same plugin that can show the finished work to the person; each
  // screen's when says which fits.
  "presents?": "string[] > 0",
});
export type WorkflowActionBuilder = typeof WorkflowActionBuilder.infer;

// A specialist the coordinator composes into its plan, and the actions it can be started on.
export const SpecialistBuilder = Common.merge({
  runs: "'specialist'",
  actions: type({
    "[string]": WorkflowActionBuilder.or(ScreenActionBuilder),
  }),
});
export type SpecialistBuilder = typeof SpecialistBuilder.infer;

// Guidance for reaching an outcome through other plugins' actions. While a project follows it, a
// step's facts that only the person's answer on a screen makes true hold the step back while the
// person decides approvals; the step's other facts are advice that execute passes on.
export const RouteBuilder = Common.merge({
  runs: "'route'",
  guidance: "string > 0",
  steps: type({
    "+": "reject",
    plugin: "string > 0",
    action: "string > 0",
    requires: Facts,
  })
    .array()
    .atLeastLength(1),
  outcome: "string > 0",
});
export type RouteBuilder = typeof RouteBuilder.infer;

// Guidance a specialist's agent reads when its work calls for it: the markdown files in skills,
// which the host lays into the agent's workspace and lists in its assignment, one line per pack.
// extends names the specialist, or the pack this one narrows, as a framework's pack narrows a web
// app pack, so a new framework is a new pack without a change to the one it narrows. The
// coordinator never sees a pack.
export const SkillsBuilder = type({
  handle: "string > 0",
  runs: "'skills'",
  extends: "string > 0",
  // The specialist's actions it serves; without it, every action the pack it narrows serves.
  "actions?": "string[] > 0",
  when: "string > 0",
  skills: "string > 0",
});
export type SkillsBuilder = typeof SkillsBuilder.infer;

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

// A filed artifact at the version the person was shown, such as a document they approved.
export type Shown = { artifactId: string; version: number };

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
  // Each project value the answer saves, by its registered name, taken from the screen's output.
  writes?: Record<string, (output: Type<Out>["infer"]) => string>;
  // What the answer approves, each at the version the person was shown; the manifest's returns
  // says which facts that may make true.
  approves?: (output: Type<Out>["infer"]) => readonly Shown[];
};

export const defineScreen = <In, Out, Data, Prepared>(
  screen: Screen<In, Out, Data, Prepared>,
) => screen;

// A workflow action's input and how the coordinator fills it; when and unless are its manifest's.
export type Workflow<In> = {
  input: Type<In>;
  describe: Pick<Describe<keyof Type<In>["inferIn"]>, "summary" | "fields">;
};

export const defineWorkflow = <In>(workflow: Workflow<In>) => workflow;

// What a specialist is told to do. A placeholder instruction repeated across turns ends the
// coordinator in a doom loop; a length floor the schema states gives it a refusal to act on instead.
export const Instruction =
  NativeSpecialistAssignment.get("instruction").and("string >= 40");

// What a screen placed on the page shares with the prompt box the person still types in.
export type PageControls<Output> = {
  // What the prompt box sends in place of a reply, built with the typed text as its message; null
  // while there is nothing to send, so typing answers in words.
  stage(compose: ((message: string | undefined) => Output) | null): void;
  // Sends what is staged with the prompt box's text, as its Send does.
  sendStaged(): void;
  // Back to the conversation without answering; the screen keeps its draft until reopened.
  close(): void;
};

// What the interface hands a screen's view. Plain props, so this package needs no React. host
// holds what the manifest names under host, and page is there for a screen placed on the page.
export type ScreenViewProps<Input, Output, Prepared, Host = unknown> = {
  input: Input;
  project: ProjectValues;
  prepared: Prepared;
  facts: readonly Fact[];
  draft: Partial<Output>;
  setDraft(change: Partial<Output>): void;
  submit(output: Output): Promise<void>;
  submitting: boolean;
  answer: Output | undefined;
  host?: Host;
  page?: PageControls<Output> | undefined;
};

export type Refused = { ok: false; refusal: Refusal; text: string };

// What did not happen, as the refusal's first words: "was not shown" for a screen.
const SHOWN = "was not shown";
const STARTED = "was not started";

const refused = (
  handle: string,
  outcome: string,
  refusal: Refusal,
  input: unknown,
): Refused => ({
  ok: false,
  refusal,
  text: refusalText(handle, outcome, refusal, input),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a module's default export is a workflow action's input, as defineWorkflow makes one. */
export const isWorkflow = (value: unknown): value is Workflow<unknown> =>
  isRecord(value) &&
  typeof value["input"] === "function" &&
  isRecord(value["describe"]) &&
  typeof value["describe"]["summary"] === "string" &&
  isRecord(value["describe"]["fields"]);

/** Whether a module's default export is a screen, as defineScreen makes one. */
export const isScreen = (
  value: unknown,
): value is Screen<unknown, unknown, unknown, unknown> =>
  isRecord(value) && typeof value["output"] === "function" && isWorkflow(value);

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
      SHOWN,
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
    return refused(handle, SHOWN, error.refusal, input);
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
      SHOWN,
      schemaRefusal({}, output),
      fineFields(rawOutput, output),
    );
  return { ok: true, output };
}

export function checkWorkflowInput<In>(
  handle: string,
  workflow: Workflow<In>,
  rawInput: unknown,
): { ok: true; input: Type<In>["infer"] } | Refused {
  const input = workflow.input(rawInput);
  if (input instanceof type.errors)
    return refused(
      handle,
      STARTED,
      schemaRefusal(workflow.describe.fields, input),
      fineFields(rawInput, input),
    );
  return { ok: true, input };
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
  lines.push("", inputText(fields));
  return lines.join("\n");
}

// The input a plugin takes, field by field, as its guidance shows it.
export function inputText(fields: Record<string, Field>) {
  const lines = ["Input:"];
  const entries = Object.entries(fields);
  const width = Math.max(...entries.map(([name]) => name.length)) + 2;
  for (const [name, field] of entries) {
    lines.push(`  ${name.padEnd(width)}${field.about}`);
    if (field.choices) lines.push(...columns(field.choices, "    "));
    if (field.otherwise) lines.push(`    ${field.otherwise}`);
  }
  return lines.join("\n");
}

export function refusalText(
  handle: string,
  outcome: string,
  refusal: Refusal,
  input: unknown,
) {
  const lines = [
    `${handle} ${outcome}. One field is wrong.`,
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
