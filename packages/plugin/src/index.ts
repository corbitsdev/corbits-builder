import { scope, type, type ArkErrors, type Type } from "arktype";
import { SpecialistInstruction } from "@corbits-builder/schemas/native-specialist";

// Something true of the project that Builder works out from what it stores, such as "app_exists". A
// workflow's fact may name one of its input fields, as "filed:{kind}", for the value passed there.
// What an action requires may also name a fact that must not hold, as "!app_exists".
export type Fact = string;

const Facts = type("string > 0").array();
// Alternatives, each the facts that together let a plugin start or a screen open.
const Requires = Facts.atLeastLength(1).array().atLeastLength(1);

// What a link value holds: an http or https address the person gave. Kept as an object so a value
// that may be text or a link says which it is.
export const LinkValue = type({
  "+": "reject",
  link: type("string.url")
    .and(/^https?:\/\//i)
    .describe("an http or https address"),
});

// What a file value holds: a file the person attached to the project, by the id its material was
// filed under, and its name, which Builder fills in from the material.
export const FileValue = type({
  "+": "reject",
  file: "string > 0",
  "name?": "string > 0",
});

const ValueType = type("'text' | 'json' | 'link' | 'file'");
export type ValueType = typeof ValueType.infer;

// A named piece of project data a plugin brings, such as "brand.guidelines": what it holds, in one
// line, and what Builder checks a saved value against. text is a string; json is any JSON value;
// link and file are as above. A list of types takes a value of any one of them.
export const ValueDeclaration = type({
  "+": "reject",
  about: "string > 0",
  type: ValueType.or(ValueType.array().atLeastLength(2)),
});
export type ValueDeclaration = typeof ValueDeclaration.infer;

const Common = type({
  // Several plugins may share a handle, and a project uses one of them: the one the person selects,
  // else the one that says it is the default. Exactly one of them must.
  handle: "string > 0",
  "default?": "true",
  groups: "string[] > 0",
  when: "string > 0",
  unless: "string > 0",
  // How a person would ask for it, in their words.
  "examples?": "string[]",
  "triggers?": "string[]",
  // Each fact this plugin's work is about, in plain words, as refusals and discover say it; "!fact"
  // words the fact not holding.
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
  // What the project must have before the screen can draw anything, as a workflow action requires.
  "requires?": Requires,
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
  // The check actions of the same plugin that must pass on the saved result before the run counts
  // as finished; the workflow runs them after its agent and sends a failure back to it.
  "done?": "string[] > 0",
});
export type WorkflowActionBuilder = typeof WorkflowActionBuilder.infer;

// The ready-made checks, each a plain description the host evaluates against the project as saved.
// A network check's address is written out, or named as a field of the check's input, or as a
// project value.
export const { Proof, Address } = scope({
  Address: "string > 0 | Input | Named",
  Input: { "+": "reject", input: "string > 0" },
  Named: { "+": "reject", value: "string > 0" },
  Text: { "+": "reject", path: "string > 0", text: "string > 0" },
  // A key path into a JSON file, such as "scripts.deploy", and the value it holds there.
  Key: {
    "+": "reject",
    path: "string > 0",
    key: "string > 0",
    equals: "unknown",
  },
  Equals: { "+": "reject", name: "string > 0", equals: "unknown" },
  File: { "+": "reject", file: "string > 0" },
  FileContains: { "+": "reject", fileContains: "Text | Key" },
  Filed: { "+": "reject", filed: "string > 0" },
  Approved: { "+": "reject", approved: "string > 0" },
  DesignChosen: { "+": "reject", designChosen: "true" },
  Value: { "+": "reject", value: "string > 0 | Equals" },
  Http: { "+": "reject", http: "Address" },
  Health: {
    "+": "reject",
    health: {
      "+": "reject",
      address: "Address",
      times: "1 <= number.integer <= 5",
    },
  },
  Dns: { "+": "reject", dns: "Address" },
  // A command run against the saved app, passing when it exits 0. run is the program and its
  // arguments, never a shell line, so no part of it is read as shell syntax.
  Command: {
    "+": "reject",
    command: {
      "+": "reject",
      run: "(string > 0)[] >= 1",
      "timeoutSeconds?": "1 <= number.integer <= 300",
    },
  },
  All: { "+": "reject", all: "Proof[] >= 1" },
  Any: { "+": "reject", any: "Proof[] >= 1" },
  Not: { "+": "reject", not: "Proof" },
  Proof:
    "File | FileContains | Filed | Approved | DesignChosen | Value | Http | Health | Dns | Command | All | Any | Not",
}).export();
export type Proof = typeof Proof.infer;
export type Address = typeof Address.infer;

// How long a check runs: once, unless stated; again every few seconds until it passes or the time
// is up; or once, waiting on the person, who may run it again or skip it.
const Speed = type("'person'").or({
  "+": "reject",
  retry: {
    "+": "reject",
    everySeconds: "1 <= number.integer <= 60",
    forSeconds: "1 <= number.integer <= 3600",
  },
});

// Proves one thing about the project as saved and records whether it holds, with evidence: every
// ready-made check in all, any ready-made check in any, or the code a module's default export runs,
// as defineCheck makes one.
export const CheckActionBuilder = type({
  runs: "'check'",
  when: "string > 0",
  "unless?": "string > 0",
  "requires?": Requires,
  returns: Facts,
  "all?": Proof.array().atLeastLength(1),
  "any?": Proof.array().atLeastLength(1),
  "check?": "string > 0",
  "speed?": Speed,
  // When the hub runs the check again by itself: never, only when asked, unless stated; or on each
  // saved change to something its latest record read.
  "rerun?": "'never' | 'change'",
}).narrow(
  (action, ctx) =>
    [action.all, action.any, action.check].filter((made) => made !== undefined)
      .length === 1 ||
    ctx.mustBe("a check with exactly one of all, any and check"),
);
export type CheckActionBuilder = typeof CheckActionBuilder.infer;

// A specialist the coordinator composes into its plan, and the actions it can be started on.
export const SpecialistBuilder = Common.merge({
  runs: "'specialist'",
  // The workflow packages the host builds and installs from this plugin, by package name: entry is
  // the module whose default export is the workflow and whose named exports are its directors, and
  // role the role its runs play, which picks their model, guidance and one-at-a-time rule.
  "packages?": {
    "[string]": { "+": "reject", entry: "string > 0", role: "string > 0" },
  },
  // The module that starts each workflow its actions' start blocks name, by that name; its default
  // export is a starter, as plugin-host's defineStarter makes one.
  "starters?": { "[string]": "string > 0" },
  actions: type({
    "[string]":
      WorkflowActionBuilder.or(ScreenActionBuilder).or(CheckActionBuilder),
  }),
});
export type SpecialistBuilder = typeof SpecialistBuilder.infer;

// When a route step waits for the person's go-ahead: required always waits for the person's own
// answer, even when they left approvals to Builder; optional waits only while they decide approvals.
const ApprovalWhen = type("'required' | 'optional'");
export type ApprovalWhen = typeof ApprovalWhen.infer;

// One step of a route: a plugin action, the facts the route suggests having first, and, so a plan
// can hold it, a title and the input it starts on. An optional step is one the person may decline.
// approval is the one way a step asks for the person's go-ahead: of names the document kinds they
// approve, and "design" for the design they choose; a step without it asks for none.
export const RouteStepBuilder = type({
  "+": "reject",
  plugin: "string > 0",
  action: "string > 0",
  requires: Facts,
  "optional?": "boolean",
  "approval?": {
    "+": "reject",
    of: type("string > 0").array().atLeastLength(1),
    when: ApprovalWhen,
  },
  "title?": "string > 0",
  "input?": "Record<string, unknown>",
});
export type RouteStepBuilder = typeof RouteStepBuilder.infer;

// Guidance for reaching an outcome through other plugins' actions. While a project follows it, a
// step's approval holds the step back as its when says; the facts it requires are advice that
// execute passes on.
export const RouteBuilder = Common.merge({
  runs: "'route'",
  guidance: "string > 0",
  steps: RouteStepBuilder.array().atLeastLength(1),
  // The fact that ends the route. A route with none is followed until the coordinator leaves it.
  "outcome?": "string > 0",
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

// One field of an input or answer that is wrong: its problem, then what it takes, as its choices or,
// for a field with none, the rule its about states.
export type WrongField = {
  field: string;
  problem: string;
  about?: string;
  choices?: Record<string, string>;
  // The sentence after the choices, for a field that also takes something besides them.
  otherwise?: string;
};

// Every wrong field at once, so an agent fixing one is never refused again for the next. next
// replaces the plain "call again with these corrected" where a refusal needs other advice.
export type Refusal = { wrong: readonly WrongField[]; next?: string };

export class RefusalError extends Error {
  constructor(readonly refusal: Refusal) {
    super(
      refusal.wrong
        .map(({ field, problem }) => `${field}: ${problem}`)
        .join("; "),
    );
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
  // Each of the person's preferences the answer sets for the project, by its id, to the option
  // taken from the screen's output.
  prefers?: Record<string, (output: Type<Out>["infer"]) => string>;
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

// The ready-made checks by name, for custom code to combine and run with view.check.
export const file = (path: string): Proof => ({ file: path });
export const fileContains = (
  path: string,
  holds: string | { key: string; equals: unknown },
): Proof => ({
  fileContains:
    typeof holds === "string"
      ? { path, text: holds }
      : { path, key: holds.key, equals: holds.equals },
});
export const filed = (kind: string): Proof => ({ filed: kind });
export const approved = (kind: string): Proof => ({ approved: kind });
export const designChosen = (): Proof => ({ designChosen: true });
// Set, or with equals, holding that JSON value.
export const value = (name: string, equals?: unknown): Proof => ({
  value: equals === undefined ? name : { name, equals },
});
export const http = (address: Address): Proof => ({ http: address });
export const health = (address: Address, times: number): Proof => ({
  health: { address, times },
});
export const dns = (address: Address): Proof => ({ dns: address });
export const command = (run: string[], timeoutSeconds?: number): Proof => ({
  command: timeoutSeconds === undefined ? { run } : { run, timeoutSeconds },
});
export const all = (...proofs: Proof[]): Proof => ({ all: proofs });
export const any = (...proofs: Proof[]): Proof => ({ any: proofs });
export const not = (proof: Proof): Proof => ({ not: proof });

/** Whether a check held, in a line, with the lines of evidence that show it. */
export type CheckOutcome = {
  pass: boolean;
  summary: string;
  evidence: readonly string[];
};

export const pass = (
  summary: string,
  evidence: readonly string[] = [],
): CheckOutcome => ({ pass: true, summary, evidence });
export const fail = (
  summary: string,
  evidence: readonly string[] = [],
): CheckOutcome => ({ pass: false, summary, evidence });

/**
 * A command run against the saved app: the step it ended on, its exit code (null when it did not
 * finish), the tail of its output and whether it ran out of time; or why it could not run.
 */
export type CommandRun =
  | {
      step: "install" | "command";
      exitCode: number | null;
      output: string;
      timedOut: boolean;
    }
  | { error: string };

/**
 * The project as saved, read-only, as a check sees it: never a run's work in progress. Each read is
 * recorded, so a pass goes stale once what it read changes.
 */
export type ProjectView = {
  app: {
    // The saved version: a commit of the app repository, or a filed version; undefined while the
    // project has no app. Reading it ties the check to the whole app, as a check that cannot name
    // the paths it depends on is, so any new version makes its record stale.
    version: string | undefined;
    // Whether a path is in the app; the record goes stale when that changes.
    has(path: string): Promise<boolean>;
    // A text file's content, cut at the host's size cap; undefined when there is no such file. The
    // record goes stale when the file's content changes or it comes or goes.
    read(path: string): Promise<string | undefined>;
    // Runs a command against the saved version in a sandbox of its own, after installing its
    // packages: how the step that ended it went, or why it could not run at all.
    run(argv: readonly string[], timeoutSeconds: number): Promise<CommandRun>;
  };
  documents: {
    // The kinds of document filed in the project.
    kinds(): Promise<readonly string[]>;
    // A filed document's content at its current version, undefined when none of the kind is filed.
    read(kind: string): Promise<string | undefined>;
  };
  // A project value as stored, null while the project has none.
  values(name: string): Promise<unknown>;
  // Whether the person approved the current version of a document kind.
  approvals(kind: string): Promise<boolean>;
  facts(): Promise<ReadonlySet<Fact>>;
  // Runs a ready-made check, or several combined, against this view.
  check(proof: Proof): Promise<CheckOutcome>;
};

/** A check's own code: what input it takes, and how it decides from the project as saved. */
export type Check<In> = {
  input?: Type<In>;
  run(view: ProjectView, input: In): CheckOutcome | Promise<CheckOutcome>;
};

export const defineCheck = <In = Record<string, never>>(check: Check<In>) =>
  check;

/** Whether a module's default export is a check's own code, as defineCheck makes it. */
export const isCheck = (value: unknown): value is Check<unknown> =>
  isRecord(value) &&
  typeof value["run"] === "function" &&
  (value["input"] === undefined || typeof value["input"] === "function");

// What a specialist is told to do. A placeholder instruction repeated across turns ends the
// coordinator in a doom loop; a length floor the schema states gives it a refusal to act on instead.
export const Instruction = SpecialistInstruction.and("string >= 40");

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

/** Each field a schema's errors name, with the first problem each has. */
export function wrongFields(errors: ArkErrors) {
  const wrong = new Map<string, string>();
  for (const error of errors) {
    const [head = "input", ...inside] = error.path;
    const field = String(head);
    if (!wrong.has(field))
      wrong.set(
        field,
        inside.length > 0
          ? `${inside.join(".")} ${error.problem}`
          : error.problem,
      );
  }
  return [...wrong].map(([field, problem]) => ({ field, problem }));
}

function schemaRefusal(
  fields: Record<string, Field | undefined>,
  errors: ArkErrors,
): Refusal {
  return {
    wrong: wrongFields(errors).map(({ field, problem }) => {
      const wrong: WrongField = { field, problem };
      const described = fields[field];
      if (described?.choices) wrong.choices = described.choices;
      else if (described) wrong.about = described.about;
      if (described?.otherwise) wrong.otherwise = described.otherwise;
      return wrong;
    }),
  };
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

const wrongNames = ({ wrong }: Refusal) => [
  ...new Set(wrong.map(({ field }) => field)),
];

/** How many fields are wrong, as a sentence: "One field is wrong." */
export function wrongCount(refusal: Refusal) {
  const { length } = wrongNames(refusal);
  return length === 1 ? "One field is wrong." : `${length} fields are wrong.`;
}

/** Each wrong field with its problem and what it takes, a line or more each. */
export function wrongText({ wrong }: Refusal) {
  return wrong.flatMap(({ field, problem, about, choices, otherwise }) => {
    const lines = [`${field}: ${problem}`];
    if (choices) lines.push("  Use one of:", ...columns(choices, "    "));
    if (about) lines.push(`  It takes: ${about}`);
    if (otherwise) lines.push(`  ${otherwise}`);
    return lines;
  });
}

export function refusalText(
  handle: string,
  outcome: string,
  refusal: Refusal,
  input: unknown,
) {
  const lines = [
    `${handle} ${outcome}. ${wrongCount(refusal)}`,
    "",
    ...wrongText(refusal),
    "",
  ];
  const names = wrongNames(refusal);
  const fine = Object.entries(isRecord(input) ? input : {})
    .filter(([name]) => !names.includes(name))
    .map(([name, value]) => `${name} ${JSON.stringify(value)}`);
  if (fine.length > 0)
    lines.push(`Your other fields were fine: ${fine.join(", ")}.`);
  lines.push(
    refusal.next ??
      `Call again with the same input and ${names.join(" and ")} corrected.`,
  );
  return lines.join("\n");
}
