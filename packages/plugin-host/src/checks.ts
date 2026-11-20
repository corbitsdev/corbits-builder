import { setTimeout as sleep } from "node:timers/promises";
import { CHECK_MS } from "@corbits-builder/schemas/artifact";
import {
  fail,
  pass,
  refusalText,
  wrongFields,
  type Check,
  type CheckOutcome,
  type Fact,
  type Proof,
  type ProjectView,
  type Refused,
  type WrongField,
} from "@corbits-builder/plugin";
import { type } from "arktype";
import type { CheckAction } from "./catalog.ts";
import { templateField } from "./facts.ts";

// How long a command check may run unless it says less, and how much longer the host may take to
// start its sandbox and stop it.
export const COMMAND_SECONDS = 300;
export const COMMAND_GRACE_MS = 15_000;

export const NO_APP = "the project has no code filed yet";

/** The project as saved, as a host reads it for a check; ready-made checks run over it. */
export type Saved = Omit<ProjectView, "check">;

type Input = Readonly<Record<string, unknown>>;
// The ready-made checks that name this key.
type Of<Key extends string> = Extract<Proof, Record<Key, unknown>>;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The work, or what late gives once ms have passed without it.
async function within<T>(ms: number, work: Promise<T>, late: () => T) {
  const timer = new AbortController();
  const timeout = async () => {
    await sleep(ms, undefined, { signal: timer.signal });
    return late();
  };
  try {
    return await Promise.race([work, timeout()]);
  } finally {
    timer.abort();
  }
}

// The value at a dotted key path in a JSON text, or why there is none.
function atKey(text: string, key: string) {
  let found: unknown;
  try {
    found = JSON.parse(text);
  } catch {
    return { missing: "is not JSON" };
  }
  for (const part of key.split(".")) {
    if (typeof found !== "object" || found === null || !(part in found))
      return { missing: `has no ${key}` };
    found = Reflect.get(found, part);
  }
  return { found };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// Several checks combined: each one's summary as evidence, prefixed with whether it held.
async function combined(
  proofs: readonly Proof[],
  view: ProjectView,
  every: boolean,
) {
  const outcomes = [];
  for (const proof of proofs) outcomes.push(await prove(proof, view));
  const evidence = outcomes.flatMap(({ pass: held, summary, evidence }) => [
    `${held ? "ok" : "failed"}: ${summary}`,
    ...evidence.map((line) => `  ${line}`),
  ]);
  const failed = outcomes.filter((outcome) => !outcome.pass);
  const held = every ? failed.length === 0 : failed.length < outcomes.length;
  if (held)
    return pass(
      outcomes
        .filter((outcome) => outcome.pass)
        .map(({ summary }) => summary)
        .join("; "),
      evidence,
    );
  return fail(failed.map(({ summary }) => summary).join("; "), evidence);
}

async function fileProof(
  proof: Of<"file"> | Of<"fileContains">,
  view: ProjectView,
) {
  // Only the paths named are read, never the app's version, so a change elsewhere in the app
  // leaves the record standing.
  if ("file" in proof)
    return (await view.app.has(proof.file))
      ? pass(`${proof.file} is in the project's code`)
      : fail(`missing ${proof.file}`);
  const { path } = proof.fileContains;
  const text = await view.app.read(path);
  if (text === undefined) return fail(`missing ${path}`);
  if ("text" in proof.fileContains) {
    const wanted = JSON.stringify(proof.fileContains.text);
    return text.includes(proof.fileContains.text)
      ? pass(`${path} contains ${wanted}`)
      : fail(`${path} does not contain ${wanted}`);
  }
  const { key, equals } = proof.fileContains;
  const at = atKey(text, key);
  if ("missing" in at) return fail(`${path} ${at.missing}`);
  return same(at.found, equals)
    ? pass(`${path} has ${key} ${JSON.stringify(equals)}`)
    : fail(
        `${path} has ${key} ${JSON.stringify(at.found)}, not ${JSON.stringify(equals)}`,
      );
}

async function valueProof(proof: Of<"value">, view: ProjectView) {
  const name = typeof proof.value === "string" ? proof.value : proof.value.name;
  const stored = await view.values(name);
  if (stored === null || stored === undefined)
    return fail(`the project value ${name} is not set`);
  if (typeof proof.value === "string")
    return pass(`the project value ${name} is set`);
  const wanted = JSON.stringify(proof.value.equals);
  return same(stored, proof.value.equals)
    ? pass(`the project value ${name} is ${wanted}`)
    : fail(
        `the project value ${name} is ${JSON.stringify(stored)}, not ${wanted}`,
      );
}

// What a command check runs and each of its commands as shown, in order; or why it runs nothing.
async function commandSteps(
  command: Of<"command">["command"],
  view: ProjectView,
) {
  if ("run" in command) {
    const { setup, run } = command;
    return {
      steps: setup ? { setup, run } : { run },
      shown: (setup ? [setup, run] : [run]).map((argv) => argv.join(" ")),
    };
  }
  const stored = await view.values(command.value);
  const lines =
    typeof stored === "string"
      ? stored
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line !== "")
      : [];
  if (lines.length === 0)
    return {
      missing: `the project has not declared its checks yet: its ${command.value} value holds no commands`,
    };
  return { steps: { lines }, shown: lines };
}

async function commandProof(proof: Of<"command">, view: ProjectView) {
  if (view.app.version === undefined) return fail(NO_APP);
  const { timeoutSeconds = COMMAND_SECONDS } = proof.command;
  const planned = await commandSteps(proof.command, view);
  if ("missing" in planned) return fail(planned.missing);
  const { steps, shown } = planned;
  const whole = shown.join(", then ");
  const ran = await view.app.run(steps, timeoutSeconds);
  if ("error" in ran) return fail(`${whole} could not run: ${ran.error}`);
  const ended = ran.step === null ? whole : (shown[ran.step] ?? whole);
  const evidence = [
    `command: ${ended}`,
    `exit code: ${ran.exitCode ?? "none"}`,
    ...ran.output.trimEnd().split("\n"),
  ];
  if (ran.timedOut)
    return fail(`${whole} ran past ${timeoutSeconds} seconds`, evidence);
  if (ran.exitCode !== 0) {
    const skipped = shown.slice((ran.step ?? shown.length) + 1);
    const failed = `${ended} exited ${ran.exitCode ?? "without a code"}`;
    return fail(
      skipped.length === 0
        ? failed
        : `${failed}, so ${skipped.join(", then ")} did not run`,
      evidence,
    );
  }
  return pass(`${whole} succeeded on the project's code`, evidence);
}

/** Runs a ready-made check, or several combined, against the project as saved. */
export async function prove(
  proof: Proof,
  view: ProjectView,
): Promise<CheckOutcome> {
  if ("all" in proof) return combined(proof.all, view, true);
  if ("any" in proof) return combined(proof.any, view, false);
  if ("not" in proof) {
    const inner = await prove(proof.not, view);
    return inner.pass
      ? fail(`not so: ${inner.summary}`, inner.evidence)
      : pass(`as wanted, ${inner.summary}`, inner.evidence);
  }
  if ("file" in proof || "fileContains" in proof) return fileProof(proof, view);
  if ("filed" in proof)
    return (await view.documents.kinds()).includes(proof.filed)
      ? pass(`the ${proof.filed} document is filed`)
      : fail(`the ${proof.filed} document is not filed`);
  if ("approved" in proof)
    return (await view.approvals(proof.approved))
      ? pass(`the ${proof.approved} is approved`)
      : fail(`the ${proof.approved} is not approved`);
  if ("designChosen" in proof)
    return (await view.approvals("design"))
      ? pass("the person chose a design")
      : fail("the person has not chosen a design");
  if ("value" in proof) return valueProof(proof, view);
  return commandProof(proof, view);
}

/** What a ready-made check proves, in words, for an action's guidance. */
export function proofText(proof: Proof): string {
  if ("all" in proof) return proof.all.map(proofText).join(", and ");
  if ("any" in proof) return proof.any.map(proofText).join(", or ");
  if ("not" in proof) return `not so: ${proofText(proof.not)}`;
  if ("file" in proof) return `${proof.file} is in the project's code`;
  if ("fileContains" in proof) {
    const { path } = proof.fileContains;
    return "text" in proof.fileContains
      ? `${path} contains ${JSON.stringify(proof.fileContains.text)}`
      : `${path} has ${proof.fileContains.key} ${JSON.stringify(proof.fileContains.equals)}`;
  }
  if ("filed" in proof) return `the ${proof.filed} document is filed`;
  if ("approved" in proof) return `the ${proof.approved} is approved`;
  if ("designChosen" in proof) return "the person chose a design";
  if ("value" in proof)
    return typeof proof.value === "string"
      ? `the project value ${proof.value} is set`
      : `the project value ${proof.value.name} is ${JSON.stringify(proof.value.equals)}`;
  return "run" in proof.command
    ? `${proof.command.run.join(" ")} succeeds on the project's code`
    : `the commands in the project value ${proof.command.value} succeed on the project's code`;
}

/**
 * How long one run of a ready-made check may take: CHECK_MS, and each command's own time on top
 * with the time its sandbox takes to start and stop.
 */
export function checkMs(proof: Proof): number {
  const commandMs = (inner: Proof): number => {
    if ("all" in inner) return sum(inner.all.map(commandMs));
    if ("any" in inner) return sum(inner.any.map(commandMs));
    if ("not" in inner) return commandMs(inner.not);
    if (!("command" in inner)) return 0;
    const seconds = inner.command.timeoutSeconds ?? COMMAND_SECONDS;
    return seconds * 1000 + COMMAND_GRACE_MS;
  };
  return CHECK_MS + commandMs(proof);
}
const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const NOT_RUN = "was not run";

/**
 * A ready-made check's input, every field it names given as text and none other; or the refusal,
 * every wrong field at once.
 */
export function validateFields(
  name: string,
  fields: readonly string[],
  raw: unknown,
): { ok: true; input: Input } | Refused {
  const given: Input =
    typeof raw === "object" && raw !== null
      ? Object.fromEntries(Object.entries(raw))
      : {};
  const wrong: WrongField[] = [
    ...fields
      .filter(
        (field) => typeof given[field] !== "string" || given[field] === "",
      )
      .map((field) => ({
        field,
        problem: "must be text",
      })),
    ...Object.keys(given)
      .filter((field) => !fields.includes(field))
      .map((field) => ({ field, problem: `is not an input of ${name}` })),
  ];
  if (wrong.length === 0) return { ok: true, input: given };
  return {
    ok: false,
    refusal: { wrong },
    text: refusalText(name, NOT_RUN, { wrong }, given),
  };
}

/** A custom check's input as its own schema takes it, or the refusal. */
export function validateCodeInput(
  name: string,
  code: Check<unknown>,
  raw: unknown,
): { ok: true; input: unknown } | Refused {
  if (!code.input) return validateFields(name, [], raw);
  const input = code.input(raw);
  if (!(input instanceof type.errors)) return { ok: true, input };
  const refusal = { wrong: wrongFields(input) };
  return { ok: false, refusal, text: refusalText(name, NOT_RUN, refusal, raw) };
}

/** The input fields a fact names, as "live:{address}" names address. */
export const factFields = (facts: readonly Fact[]) =>
  facts.flatMap((fact) => templateField(fact) ?? []);

/**
 * Runs a check once within ms, the time its action may take. What the check throws, or a check
 * that outlasts that time, is recorded as a failure with the error as its evidence.
 */
export async function runCheck(
  { name, run, ms }: Pick<CheckAction, "name" | "run" | "ms">,
  saved: Saved,
  input: unknown,
) {
  const view: ProjectView = {
    app: saved.app,
    documents: saved.documents,
    values: saved.values,
    value: saved.value,
    approvals: saved.approvals,
    facts: saved.facts,
    check: (proof) => prove(proof, view),
  };
  try {
    return await within(ms, run(view, input), () =>
      fail(`${name} took longer than ${ms / 1000} seconds`),
    );
  } catch (error) {
    return fail(`${name} broke: ${message(error)}`, [
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : message(error),
    ]);
  }
}

/** Runs a check again every few seconds until it passes or the time is up; its last outcome. */
export async function keepChecking(
  attempt: () => Promise<CheckOutcome>,
  { everySeconds, forSeconds }: { everySeconds: number; forSeconds: number },
) {
  const deadline = Date.now() + forSeconds * 1000;
  let outcome = await attempt();
  while (!outcome.pass && Date.now() + everySeconds * 1000 <= deadline) {
    await sleep(everySeconds * 1000);
    outcome = await attempt();
  }
  return outcome;
}
