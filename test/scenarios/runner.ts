/**
 * A scenario is one small real run through the real hub with every model turn scripted: the
 * starting project, the turns of the coordinator and of each specialist it starts, what the person
 * does, and what must hold at the end. Each run writes trace.md and trace.json to
 * SCENARIO_DIR/<name>/: every step in order, what was sent and what came back.
 */
import { expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import { chromium, type Page } from "@playwright/test";
import type { ProjectArtifact } from "@corbits-builder/client";
import { ProjectExport } from "@corbits-builder/schemas/project";
import type { QuestionAnswer } from "@intx/types/signals";
import { signIn, startWebApp, watchPage } from "./browser.ts";
import { readRunConversation } from "../e2e/support/extract.ts";
import { startTestHub, type TestHubHandle } from "../e2e/support/hub.ts";
import {
  findArtifact,
  FIXTURE_DIR,
  NonEmptyString,
  openQuestionPark,
  STAGE_DEADLINE_MS,
} from "../e2e/support/pipeline-driver.ts";
import {
  formatOpenAISseResponse,
  loadScenarioBundle,
  OpenAISseChunk,
  startRecordedModelServer,
  writeScenarioFixture,
  type AgentRole,
  type ExchangeExpectation,
  type ModelExchange,
  type RecordedModelServer,
  type ToolResultExpectation,
} from "../e2e/support/recorded-model.ts";
import { DESIGNER_REPORT, WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";

const SCENARIO_DIR = NonEmptyString.assert(process.env["SCENARIO_DIR"]);
const POLL_MS = 1_000;
// How much of a long text trace.md shows; trace.json keeps all of it.
const SHOWN = 1_200;

// ---- Scripted model turns ----

type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
export type Reply = { text?: string; toolCalls?: ToolCall[] };
type When = Omit<ExchangeExpectation, "requiredTools">;
export type Turn = Readonly<{
  when: When;
  reply: Reply;
  requiredTools?: string[];
  // A failing HTTP status the model answers with instead, its error message the reply's text.
  status?: number;
}>;

/** The turn answers a message from the person or the host, containing the text when given. */
export function user(contains?: string): When {
  const when: When = { lastMessageRole: "user", toolResults: [] };
  if (contains !== undefined) when.userTextContains = contains;
  return when;
}

/** The turn answers the results of the model's previous tool calls, all of them, in any order. */
export function results(...expected: ToolResultExpectation[]): When {
  return { lastMessageRole: "tool", toolResults: expected };
}

function result(
  callId: string,
  toolName: string,
  isError: boolean,
  contains: string | undefined,
): ToolResultExpectation {
  const expected: ToolResultExpectation = { callId, toolName, isError };
  if (contains !== undefined) expected.contains = contains;
  return expected;
}

/**
 * The result, with the values at JSON paths in it kept by name; a later turn sends one as
 * bound(name), such as a run id execute returned.
 */
export function keep(
  expected: ToolResultExpectation,
  bind: Record<string, string>,
): ToolResultExpectation {
  expected.bind = bind;
  return expected;
}
export const bound = (name: string) => `{{bind:${name}}}`;

export const ok = (callId: string, toolName: string, contains?: string) =>
  result(callId, toolName, false, contains);
export const refused = (callId: string, toolName: string, contains?: string) =>
  result(callId, toolName, true, contains);
/** The call's result, whether it ran or was refused. */
export const settled = (callId: string, toolName: string) => ({
  callId,
  toolName,
});

export const say = (text: string): Reply => ({ text });
export const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
): Reply => ({ toolCalls: [{ id, name, arguments: args }] });
export const calls = (...replies: Reply[]): Reply => ({
  toolCalls: replies.flatMap((reply) => reply.toolCalls ?? []),
});
export const execute = (
  id: string,
  plugin: string,
  action: string | undefined,
  input: Record<string, unknown>,
) =>
  call(
    id,
    "execute",
    action === undefined ? { plugin, input } : { plugin, action, input },
  );

/** The first run an execute result says it started. */
export function startedRun(result: string): string {
  const [first] = type({ runs: type({ runId: "string" }).array() }).assert(
    JSON.parse(result),
  ).runs;
  if (first === undefined) throw new Error(`No run was started: ${result}`);
  return first.runId;
}

export const turn = (when: When, reply: Reply, requiredTools?: string[]) =>
  requiredTools === undefined
    ? { when, reply }
    : { when, reply, requiredTools };

/** A turn the model answers with a failing HTTP status and an error carrying the message. */
export const failsWith = (
  when: When,
  status: number,
  message: string,
  requiredTools: string[],
): Turn => ({ when, reply: say(message), requiredTools, status });

/** The recorded weather project's turns of one run, by its key in test/fixtures/pipeline. */
export async function recorded(runKey: string): Promise<Turn[]> {
  const { runs } = await loadScenarioBundle(FIXTURE_DIR);
  const run = runs.find((named) => named.runKey === runKey);
  if (!run) throw new Error(`No recorded run ${runKey}`);
  return run.exchanges.map(({ expect, responseSse }) => {
    const when: When = {
      lastMessageRole: expect.lastMessageRole,
      toolResults: expect.toolResults,
    };
    if (expect.userTextContains !== undefined)
      when.userTextContains = expect.userTextContains;
    return {
      when,
      reply: decodeReply(responseSse),
      requiredTools: expect.requiredTools,
    };
  });
}

// The tools each role must be offered in every turn, unless a turn names its own.
const REQUIRED_TOOLS: Record<AgentRole, string[]> = {
  coordinator: ["execute", "question"],
  writer: ["write_artifact"],
  designer: ["check_design", "file_design_option"],
  coder: ["edit_file", "run_shell"],
  reviewer: [],
  presenter: [],
};

// check-app outlasts run_shell's 30-second default on a busy machine, the first build most of all.
export const CHECK_APP_MS = 180_000;

/** Recorded turns whose app checks get the longer time limit the scripted coders use. */
export function withLongerAppCheck(turns: readonly Turn[]): Turn[] {
  return turns.map(({ when, reply, requiredTools }) => {
    const longer: Reply = {};
    if (reply.text !== undefined) longer.text = reply.text;
    if (reply.toolCalls !== undefined)
      longer.toolCalls = reply.toolCalls.map((made) =>
        made.name === "run_shell" && made.arguments["command"] === "check-app"
          ? {
              id: made.id,
              name: made.name,
              arguments: { command: "check-app", timeout: CHECK_APP_MS },
            }
          : made,
      );
    return requiredTools === undefined
      ? { when, reply: longer }
      : { when, reply: longer, requiredTools };
  });
}

// ---- The weather project on the build-web-app plan ----

export const WEATHER_IDEA =
  "I want a weather app where the whole screen animates to match the live weather.";

/** The coordinator's turns from the idea until it asks the person to approve the requirements. */
export const WEATHER_REQUIREMENTS: readonly Turn[] = [
  turn(
    user("weather app"),
    execute("c_follow", "build-web-app", undefined, {}),
  ),
  turn(
    results(ok("c_follow", "execute", "write-requirements")),
    execute("c_requirements", "writer", "write-requirements", {
      instruction:
        "An animated weather web app: current conditions, 24-hour and 7-day forecasts, saved cities and a compare view, using Open-Meteo.",
    }),
  ),
  turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
  turn(
    user("written the requirements"),
    execute("c_approve_requirements", "writer", "approve", {
      kinds: ["product_requirements"],
    }),
  ),
];

const requirementsApproved = results(
  ok("c_approve_requirements", "execute", '"approved"'),
);

/** The coordinator's turns from the approved requirements to the built app. */
export const WEATHER_BUILD: readonly Turn[] = [
  turn(
    requirementsApproved,
    execute("c_mockup", "designer", "mockup", WEATHER_MOCKUP),
  ),
  turn(results(ok("c_mockup", "execute")), say("A designer is on it.")),
  turn(
    user(DESIGNER_REPORT),
    execute("c_choose", "designer", "review", {
      note: "The weather-driven design. Approve it to build from it.",
    }),
  ),
  turn(
    results(ok("c_choose", "execute", '"approved"')),
    execute("c_plan", "writer", "write-build-plan", {
      instruction: "Plan the build of the approved requirements and design.",
    }),
  ),
  turn(
    results(ok("c_plan", "execute")),
    say("A writer is planning the build."),
  ),
  turn(user(`The person chose the ${WEATHER_CONCEPT.label}`), say("Noted.")),
  turn(
    user("written the build plan"),
    execute("c_approve_plan", "writer", "approve", {
      kinds: ["build_plan"],
    }),
  ),
  turn(
    results(ok("c_approve_plan", "execute", '"approved"')),
    execute("c_build", "coder", "build", {
      starter: "web-app",
      instruction: "Build the whole app from the plan and the chosen design.",
    }),
  ),
  turn(results(ok("c_build", "execute")), say("A coder is building it.")),
  turn(user("Animated Weather"), say("Your app is built.")),
];

/** The recorded specialists the plan starts, by the run keys the weather turns use. */
export const WEATHER_SPECIALISTS: Readonly<
  Record<"requirements" | "designer" | "plan" | "coder", Specialist>
> = {
  requirements: { role: "writer", turns: await recorded("writer-4") },
  designer: { role: "designer", turns: await recorded("designer-1") },
  plan: { role: "writer", turns: await recorded("writer-5") },
  coder: {
    role: "coder",
    turns: withLongerAppCheck(await recorded("coder-1")),
  },
};

/** The person approves the first version of the document of the kind when asked to. */
async function approveFirst(p: Person, kind: string) {
  const filed = await p.filed(kind, 1);
  await p.question();
  const answered = await p.answer({
    output: { approved: [{ kind, artifactId: filed.artifactId, version: 1 }] },
  });
  expect(answered.status).toBe(200);
}

/** The person approves the requirements, the design and the plan until the app is built. */
export async function buildWeather(p: Person) {
  await approveFirst(p, "product_requirements");
  const option = await p.filed("design_option", 1);
  await p.question();
  const chosen = await p.answer({
    output: {
      decision: "approved",
      option: option.artifactId,
      version: option.version,
      comments: [],
    },
  });
  expect(chosen.status).toBe(200);
  await approveFirst(p, "build_plan");
  await p.filed("app", 1);
  await p.heard("Your app is built.");
}

// ---- Starting projects ----

/**
 * fresh: a new project whose coordinator is first sent the idea. weather-documents: the weather
 * project with its requirements approved and no design yet. weather-app: the same project built,
 * its app at version 1. The weather projects are run once from the idea on the plan above,
 * exported and kept in SCENARIO_DIR/.cache, then imported into each scenario's hub.
 */
export type Start =
  | Readonly<{ fresh: string }>
  | "weather-documents"
  | "weather-app";

const STARTS: Record<"weather-documents" | "weather-app", Scenario> = {
  "weather-documents": {
    name: "weather-documents",
    title: "Animated Weather App",
    start: { fresh: WEATHER_IDEA },
    coordinator: [
      ...WEATHER_REQUIREMENTS,
      turn(requirementsApproved, say("The requirements are approved.")),
    ],
    specialists: { requirements: WEATHER_SPECIALISTS.requirements },
    person: async (p) => {
      await approveFirst(p, "product_requirements");
      await p.heard("The requirements are approved.");
    },
  },
  "weather-app": {
    name: "weather-app",
    title: "Animated Weather App",
    start: { fresh: WEATHER_IDEA },
    coordinator: [...WEATHER_REQUIREMENTS, ...WEATHER_BUILD],
    specialists: WEATHER_SPECIALISTS,
    person: buildWeather,
  },
};

export async function startingProject(
  start: "weather-documents" | "weather-app",
): Promise<ProjectExport> {
  const cached = join(SCENARIO_DIR, ".cache", `${start}.json`);
  if (await Bun.file(cached).exists())
    return ProjectExport.assert(JSON.parse(await readFile(cached, "utf8")));
  let exported: ProjectExport | undefined;
  await runScenario(STARTS[start], async (person) => {
    exported = await person.hub.client.exportProject(
      person.tenantId,
      person.projectId,
    );
  });
  if (exported === undefined) throw new Error(`${start} was not exported`);
  await mkdir(join(SCENARIO_DIR, ".cache"), { recursive: true });
  await writeFile(cached, JSON.stringify(exported));
  return exported;
}

// ---- The trace ----

type Step = {
  at: number;
  who: string;
  what: string;
  sent?: unknown;
  got?: unknown;
};

export type HubReply = Readonly<{ status: number; body: unknown }>;

// The text and tool calls a scripted reply streams.
function decodeReply(sse: string): Reply {
  let text = "";
  const toolCalls: { id: string; name: string; args: string }[] = [];
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const chunk = OpenAISseChunk.assert(
      JSON.parse(line.slice("data: ".length)),
    );
    for (const choice of chunk.choices) {
      text += choice.delta.content ?? "";
      for (const part of choice.delta.tool_calls ?? []) {
        const known = toolCalls[part.index];
        if (known) known.args += part.function.arguments;
        else
          toolCalls[part.index] = {
            id: part.id ?? "",
            name: part.function.name ?? "",
            args: part.function.arguments,
          };
      }
    }
  }
  const reply: Reply = {};
  if (text !== "") reply.text = text;
  if (toolCalls.length > 0)
    reply.toolCalls = toolCalls.map(({ id, name, args }) => ({
      id,
      name,
      arguments: type("Record<string, unknown>").assert(JSON.parse(args)),
    }));
  return reply;
}

function modelStep(exchange: ModelExchange): Step {
  const who =
    exchange.runKey === undefined
      ? exchange.role
      : `${exchange.role} (${exchange.runKey} turn ${String(exchange.index)})`;
  if (exchange.failure !== undefined)
    return {
      at: exchange.at,
      who,
      what: "the scripted model refused the request",
      sent: exchange.received,
      got: exchange.failure,
    };
  if (exchange.status !== undefined && exchange.status !== 200)
    return {
      at: exchange.at,
      who,
      what: `the scripted model answered HTTP ${String(exchange.status)}`,
      sent: exchange.received,
      got: exchange.responseSse,
    };
  return {
    at: exchange.at,
    who,
    what: "model turn",
    sent: exchange.received,
    got: decodeReply(NonEmptyString.assert(exchange.responseSse)),
  };
}

function shown(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? String(value));
  return text.length > SHOWN
    ? `${text.slice(0, SHOWN)}\n… (${String(text.length - SHOWN)} more characters in trace.json)`
    : text;
}

function block(label: string, value: unknown): string {
  return `${label}:\n\n\`\`\`\n${shown(value)}\n\`\`\`\n`;
}

const ToolResults = type({
  toolResults: type({
    callId: "string",
    isError: "boolean",
    text: "string",
  }).array(),
});

// What the model was sent, as a reader wants it: the message, or each tool result.
function sentText(step: Step): string {
  const received = type({ user: "string" })(step.sent);
  if (!(received instanceof type.errors))
    return block("Received a message", received.user);
  const tools = ToolResults(step.sent);
  if (tools instanceof type.errors) return block("Sent", step.sent);
  return tools.toolResults
    .map((item) =>
      block(
        `Received the result of ${item.callId}${item.isError ? " (an error)" : ""}`,
        item.text,
      ),
    )
    .join("\n");
}

function repliedText(step: Step): string {
  const reply = type({
    "text?": "string",
    "toolCalls?": type({
      id: "string",
      name: "string",
      arguments: "Record<string, unknown>",
    }).array(),
  })(step.got);
  if (reply instanceof type.errors) return block("Came back", step.got);
  const parts: string[] = [];
  if (reply.text !== undefined) parts.push(block("Said", reply.text));
  for (const made of reply.toolCalls ?? [])
    parts.push(block(`Called ${made.name} (${made.id})`, made.arguments));
  return parts.join("\n");
}

function markdown(
  scenario: Scenario,
  outcome: string,
  steps: readonly Step[],
  end: unknown,
  started: number,
): string {
  const lines = [
    `# ${scenario.name}: ${scenario.title}`,
    "",
    `Outcome: ${outcome}`,
    "",
  ];
  if (scenario.expectFailure !== undefined)
    lines.push(`Expected to fail because: ${scenario.expectFailure}`, "");
  if (scenario.expectChange !== undefined)
    lines.push(`Expected to change: ${scenario.expectChange}`, "");
  lines.push("## Steps", "");
  steps.forEach((step, index) => {
    const seconds = ((step.at - started) / 1_000).toFixed(1);
    lines.push(
      `### ${String(index + 1)}. +${seconds}s ${step.who}: ${step.what}`,
      "",
    );
    if (step.what === "model turn") {
      lines.push(sentText(step), repliedText(step));
      return;
    }
    if (step.sent !== undefined) lines.push(block("Sent", step.sent));
    if (step.got !== undefined) lines.push(block("Came back", step.got));
  });
  lines.push("## End state", "", block("Project", end));
  return lines.join("\n");
}

// ---- The person ----

export type OpenQuestion = Readonly<{ signalName: string; asked: unknown }>;

export type Person = Readonly<{
  hub: TestHubHandle;
  tenantId: string;
  projectId: string;
  // The project's path on the hub, /api/tenants/<tenant>/projects/<project>.
  path: string;
  coordinatorRunId: string;
  /** Sends the coordinator a message as the person. */
  say: (text: string) => Promise<void>;
  /** A hub call as the person, or with the headers given instead; never throws on a refusal. */
  call: (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<HubReply>;
  /** Waits for the question the coordinator is waiting on. */
  question: () => Promise<OpenQuestion>;
  /** Answers the open question through the hub's answers route. */
  answer: (answer: QuestionAnswer) => Promise<HubReply>;
  /** Waits until a document of the kind is filed, at the version when given. */
  filed: (kind: string, version?: number) => Promise<ProjectArtifact>;
  /** Waits until the coordinator says something containing the text. */
  heard: (text: string) => Promise<void>;
  /** Waits until every scripted turn has been asked for. */
  scriptDone: () => Promise<void>;
  /** How many turns of a scripted run have been asked for so far. */
  asked: (runKey: string) => number;
  until: <T>(what: string, check: () => Promise<T | undefined>) => Promise<T>;
  /** What a scripted tool call returned, as the model was sent it. */
  resultOf: (callId: string) => Readonly<{ isError: boolean; text: string }>;
  /** The first message a scripted run was sent: a specialist's assignment. */
  assignment: (runKey: string) => string;
  /** Every message a scripted run was sent, such as the reports the coordinator received. */
  messages: (runKey: string) => string[];
  /** Saves the project's working preferences, keeping the choices it does not name. */
  prefer: (choices: Record<string, string>) => Promise<void>;
  /** A run's stored conversation, by its workflow step. */
  conversation: (
    runId: string,
    step: string,
  ) => ReturnType<typeof readRunConversation>;
  note: (what: string, detail?: unknown) => void;
  /** Drives the real web app on this project in a headless browser, recording a video. */
  browser: (
    drive: (
      page: Page,
      shoot: (name: string) => Promise<void>,
    ) => Promise<void>,
  ) => Promise<void>;
}>;

type Specialist = Readonly<{ role: AgentRole; turns: readonly Turn[] }>;

export type Scenario = Readonly<{
  // The folder the trace goes in, such as s01-any-document.
  name: string;
  title: string;
  start: Start;
  // The coordinator's turns, then each specialist run's by a key of its own.
  coordinator: readonly Turn[];
  specialists?: Readonly<Record<string, Specialist>>;
  person: (person: Person) => Promise<void>;
  // The project values the end state reads.
  values?: readonly string[];
  // Why the product does not do this yet; the scenario passes while it still fails that way.
  expectFailure?: string;
  // What another change in flight is expected to change in what this scenario sees.
  expectChange?: string;
}>;

const IMPORTED_OPENING = turn(
  user("I just imported this project"),
  say("The project is imported."),
);

function fixtureRuns(scenario: Scenario) {
  const imported = typeof scenario.start === "string";
  const coordinator: {
    runKey: string;
    role: AgentRole;
    turns: readonly Turn[];
  } = {
    runKey: "coordinator",
    role: "coordinator",
    turns: imported
      ? [IMPORTED_OPENING, ...scenario.coordinator]
      : scenario.coordinator,
  };
  const runs = [
    coordinator,
    ...Object.entries(scenario.specialists ?? {}).map(([runKey, run]) => ({
      runKey,
      role: run.role,
      turns: run.turns,
    })),
  ];
  return runs.map(({ runKey, role, turns }) => ({
    runKey,
    role,
    stage: scenario.name,
    sourceRunId: `${scenario.name}-${runKey}`,
    exchanges: turns.map(({ when, reply, requiredTools, status }) => {
      const expect: ExchangeExpectation = {
        lastMessageRole: when.lastMessageRole,
        requiredTools: requiredTools ?? REQUIRED_TOOLS[role],
        toolResults: when.toolResults,
      };
      if (when.userTextContains !== undefined)
        expect.userTextContains = when.userTextContains;
      if (status === undefined)
        return { sse: formatOpenAISseResponse(reply), expect };
      return {
        sse: JSON.stringify({
          error: { message: reply.text, type: "server_error" },
        }),
        expect,
        status,
      };
    }),
  }));
}

// `after` runs on the project once the scenario has passed, while its hub is still open.
async function runScenario(
  scenario: Scenario,
  after?: (person: Person) => Promise<void>,
) {
  const dir = join(SCENARIO_DIR, scenario.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const started = Date.now();
  const steps: Step[] = [];
  // One line per step as it happens, so a run that hangs still shows how far it got.
  const progress = (line: string) =>
    appendFileSync(
      join(dir, "progress.log"),
      `+${((Date.now() - started) / 1_000).toFixed(1)}s ${line}\n`,
    );
  const log = (who: string, what: string, sent?: unknown, got?: unknown) => {
    steps.push({ at: Date.now(), who, what, sent, got });
    progress(`${who}: ${what}`);
  };

  const exported =
    typeof scenario.start === "string"
      ? await startingProject(scenario.start)
      : undefined;
  const runs = fixtureRuns(scenario);
  const fixtureDir = await mkdtemp(join(tmpdir(), "builder-scenario-"));
  let model: RecordedModelServer | undefined;
  let hub: TestHubHandle | undefined;
  let error: unknown;
  let end: unknown;
  try {
    await writeScenarioFixture(
      fixtureDir,
      { scenario: scenario.name, recordedFromCommit: "scripted" },
      runs,
    );
    const scripted = await startRecordedModelServer(fixtureDir);
    let reported = 0;
    scripted.onActivity(() => {
      for (const exchange of scripted.exchanges().slice(reported)) {
        const step = modelStep(exchange);
        progress(`${step.who}: ${step.what}`);
      }
      reported = scripted.exchanges().length;
    });
    model = scripted;
    const opened = await startTestHub(scripted);
    hub = opened;
    const { client, workspaceTenantId } = opened;
    let projectId: string;
    if (exported) {
      projectId = (await client.importProject(workspaceTenantId, exported))
        .projectId;
      log("person", `imported ${String(scenario.start)}`);
    } else {
      const idea = type({ fresh: "string" }).assert(scenario.start).fresh;
      projectId = scenario.name;
      await client.mutateProject(workspaceTenantId, projectId, {
        mutationId: `mut-create-${projectId}`,
        idempotencyKey: `idem-create-${projectId}`,
        command: "create_project",
        payload: {
          title: scenario.title.slice(0, 120),
          profile: "recorded_replay",
          problemStatement: idea,
        },
      });
      log("person", "created a fresh project", idea);
    }
    const listing = await client.project(workspaceTenantId, projectId);
    const tenantId = listing.tenantId;
    const coordinatorRunId = NonEmptyString.assert(listing.coordinatorRunId);
    const path = `/api/tenants/${tenantId}/projects/${projectId}`;

    const until = async <T>(
      what: string,
      check: () => Promise<T | undefined>,
    ): Promise<T> => {
      const deadline = performance.now() + STAGE_DEADLINE_MS;
      while (performance.now() < deadline) {
        const failure = scripted.firstFailure();
        if (failure) throw failure;
        const found = await check();
        if (found !== undefined) return found;
        await Bun.sleep(POLL_MS);
      }
      throw new Error(`Timed out waiting for ${what}`);
    };

    const raw = async (
      method: "GET" | "POST",
      target: string,
      body: unknown,
      headers: Record<string, string> | undefined,
    ): Promise<HubReply> => {
      const init: RequestInit = {
        method,
        headers: headers ?? {
          cookie: opened.cookie,
          origin: opened.baseUrl,
          "content-type": "application/json",
        },
      };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await fetch(new URL(target, opened.baseUrl), init);
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Not JSON: kept as the text it is.
      }
      return { status: response.status, body: parsed };
    };

    const callAs: Person["call"] = async (method, target, body, headers) => {
      const reply = await raw(method, target, body, headers);
      log(
        headers === undefined ? "person" : "caller",
        `${method} ${target.replace(path, "<project>")}`,
        body,
        reply,
      );
      return reply;
    };

    // An export carries no project values, so the imported weather app is told again that it is the
    // web app its first build started from, and the commands its builds check runs.
    if (scenario.start === "weather-app") {
      const stack = await callAs("POST", `${path}/values`, {
        values: {
          "stack.starter": "web-app",
          "stack.checks": "bun install --frozen-lockfile\nbun run build",
        },
      });
      expect(stack.status).toBe(200);
    }

    const openQuestion = () =>
      until("an open question", async () => {
        const { events } = await client.conversationEvents(tenantId, projectId);
        const park = openQuestionPark(events);
        if (!park) return undefined;
        return {
          signalName: NonEmptyString.assert(park.body["signalName"]),
          asked: park.body["question"],
        };
      });

    const person: Person = {
      hub: opened,
      tenantId,
      projectId,
      path,
      coordinatorRunId,
      say: async (text) => {
        log("person", "says to the coordinator", text);
        await client.sendMessage(tenantId, coordinatorRunId, { content: text });
      },
      call: callAs,
      question: async () => {
        const open = await openQuestion();
        log("hub", "a question is open", undefined, open);
        return open;
      },
      answer: async (answer) => {
        const { signalName } = await openQuestion();
        return callAs("POST", `${path}/answers`, { signalName, answer });
      },
      filed: (kind, version) =>
        until(`${kind} filed`, async () =>
          findArtifact(
            (await client.projectArtifacts(tenantId, projectId)).artifacts,
            kind,
            version,
          ),
        ),
      heard: async (text) => {
        await until(
          `the coordinator to say ${JSON.stringify(text)}`,
          async () => {
            const { turns } = await client.conversationEvents(
              tenantId,
              projectId,
            );
            return turns?.find(
              (said) => said.role === "assistant" && said.text.includes(text),
            );
          },
        );
      },
      scriptDone: async () => {
        await until("every scripted turn to be asked for", async () => {
          const asked = scripted.exchanges();
          const left = runs.filter(
            (run) =>
              asked.filter((exchange) => exchange.runKey === run.runKey)
                .length < run.exchanges.length,
          );
          return left.length === 0 || undefined;
        });
      },
      asked: (runKey) =>
        scripted.exchanges().filter((exchange) => exchange.runKey === runKey)
          .length,
      until,
      resultOf: (callId) => {
        for (const exchange of scripted.exchanges()) {
          const sent = ToolResults(exchange.received);
          if (sent instanceof type.errors) continue;
          const found = sent.toolResults.find((item) => item.callId === callId);
          if (found) return found;
        }
        throw new Error(`No model turn was sent the result of ${callId}`);
      },
      assignment: (runKey) => {
        const first = scripted
          .exchanges()
          .find((exchange) => exchange.runKey === runKey);
        const message = type({ user: "string" }).assert(first?.received);
        return message.user;
      },
      messages: (runKey) =>
        scripted
          .exchanges()
          .filter((exchange) => exchange.runKey === runKey)
          .flatMap((exchange) => {
            const message = type({ user: "string" })(exchange.received);
            return message instanceof type.errors ? [] : [message.user];
          }),
      prefer: async (choices) => {
        const { fields } = await client.settings(tenantId, projectId);
        if (fields.preferences === undefined)
          throw new Error("The project has no working preferences to change");
        const receipt = await client.saveSettings(tenantId, projectId, {
          command: "save_settings",
          idempotencyKey: crypto.randomUUID(),
          fields: {
            preferences: {
              value: Object.assign({}, fields.preferences.value, choices),
              baseVersion: fields.preferences.version,
            },
          },
        });
        log(
          "person",
          "saved the project's working preferences",
          choices,
          receipt,
        );
      },
      conversation: (runId, step) => readRunConversation(opened, runId, step),
      note: (what, detail) => log("note", what, undefined, detail),
      browser: async (drive) => {
        const port = Number(
          NonEmptyString.assert(process.env["DEMO_WEB_PORT"]),
        );
        const { web, url } = await startWebApp(opened.baseUrl, port);
        const browser = await chromium.launch({ headless: true });
        let consoleLines: string[] = [];
        let network: Record<string, unknown>[] = [];
        try {
          const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            recordVideo: { dir, size: { width: 1280, height: 800 } },
          });
          const page = await context.newPage();
          ({ consoleLines, network } = watchPage(page, /\/answers$|\/values/));
          const shoot = async (name: string) => {
            await page.screenshot({ path: join(dir, `${name}.png`) });
            log("browser", `screenshot ${name}.png`);
          };
          try {
            await signIn(page, url);
            await page.goto(`${url}/project/${projectId}`);
            log("browser", "signed in and opened the project");
            await drive(page, shoot);
          } catch (failure) {
            await shoot("99-failure");
            throw failure;
          } finally {
            await context.close();
            await page.video()?.saveAs(join(dir, "browser.webm"));
            await page.video()?.delete();
          }
        } finally {
          for (const entry of network)
            if ("received" in entry)
              log(
                "browser",
                `${String(entry["method"])} ${String(entry["url"])} -> ${String(entry["status"])}`,
                entry["sent"],
                entry["received"],
              );
          await writeFile(join(dir, "console.log"), consoleLines.join("\n"));
          await writeFile(
            join(dir, "network.log"),
            network.map((entry) => JSON.stringify(entry)).join("\n"),
          );
          await browser.close();
          web.kill();
          await web.exited;
        }
      },
    };

    try {
      await scenario.person(person);
      await person.scriptDone();
      scripted.assertClean();
      await after?.(person);
    } catch (failure) {
      error = failure;
    }
    try {
      end = await endState(person, scenario.values);
    } catch (failure) {
      end = { unreadable: String(failure) };
    }
  } catch (failure) {
    error = failure;
  } finally {
    for (const exchange of model?.exchanges() ?? [])
      steps.push(modelStep(exchange));
    steps.sort((a, b) => a.at - b.at);
    if (hub) await hub.close();
    if (model) await model.stop();
    await rm(fixtureDir, { recursive: true, force: true });
  }

  const seconds = ((Date.now() - started) / 1_000).toFixed(0);
  const message = error instanceof Error ? error.message : String(error);
  let outcome = `passed in ${seconds}s`;
  if (error !== undefined)
    outcome =
      scenario.expectFailure === undefined
        ? `FAILED after ${seconds}s: ${message}`
        : `failed as expected after ${seconds}s: ${message}`;
  else if (scenario.expectFailure !== undefined)
    outcome = `PASSED although marked as an expected failure (${seconds}s)`;
  await writeFile(
    join(dir, "trace.json"),
    JSON.stringify(
      {
        name: scenario.name,
        title: scenario.title,
        start: scenario.start,
        outcome,
        expectFailure: scenario.expectFailure,
        expectChange: scenario.expectChange,
        started: new Date(started).toISOString(),
        steps,
        end,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(dir, "trace.md"),
    markdown(scenario, outcome, steps, end, started),
  );
  if (error !== undefined && scenario.expectFailure === undefined) throw error;
  if (error === undefined && scenario.expectFailure !== undefined)
    throw new Error(
      `${scenario.name} passes now; drop its expectFailure: ${scenario.expectFailure}`,
    );
}

// The project as it ended: its documents, approvals, the plans it is following, values, open
// questions and the last of what the person saw.
async function endState(person: Person, values: readonly string[] | undefined) {
  const { client } = person.hub;
  const { tenantId, projectId, path } = person;
  const [artifacts, decided, conversation, following] = await Promise.all([
    client.projectArtifacts(tenantId, projectId),
    client.decidedApprovals(tenantId, projectId),
    client.conversationEvents(tenantId, projectId),
    person.call("GET", `${path}/following`),
  ]);
  const keys = values ?? ["brand.guidelines", "stack.language"];
  return {
    artifacts: artifacts.artifacts.map(
      ({ kind, version, approvedVersion, artifactId }) => ({
        kind,
        version,
        approvedVersion,
        artifactId,
      }),
    ),
    inFlight: artifacts.inFlight,
    failed: artifacts.failed,
    approvals: decided.approvals,
    following: following.body,
    values: (await person.call("GET", `${path}/values?keys=${keys.join(",")}`))
      .body,
    openQuestion: openQuestionPark(conversation.events)?.body ?? null,
    lastTurns: (conversation.turns ?? [])
      .slice(-12)
      .map(({ role, text }) => ({ role, text })),
  };
}

/** Registers the scenario as a test; SCENARIO_DIR gets its trace whether it passes or not. */
export function scenario(definition: Scenario) {
  test(definition.title, () => runScenario(definition), { timeout: 0 });
}
