/**
 * One project driven through the real hub, its sidecars and Postgres, with every model turn
 * scripted: the coordinator's and each specialist run's, by a key of its own. A test says what the
 * person does through the hub's routes and what must hold.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type } from "arktype";
import { sql } from "drizzle-orm";
import type { ProjectArtifact } from "@corbits-builder/client";
import type { QuestionAnswer } from "@corbits-builder/schemas/conversation";
import type { ProjectExport } from "@corbits-builder/schemas/project";
import { runDevelopmentSeed } from "../../../scripts/seed-projects.ts";
import type { SeedFixtureId } from "../../seed/index.ts";
import { startTestHub, type TestHubHandle } from "./hub.ts";
import {
  formatOpenAISseResponse,
  loadScenarioBundle,
  OpenAISseChunk,
  startRecordedModelServer,
  writeScenarioFixture,
  type AgentRole,
  type ExchangeExpectation,
  type RecordedModelServer,
  type ToolResultExpectation,
} from "./recorded-model.ts";

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "fixtures", "pipeline");
const DEADLINE_MS = 180_000;
const POLL_MS = 500;
const NonEmptyString = type("string > 0");

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
}>;

/** The turn answers a message from the person or the hub, containing the text when given. */
export function user(contains?: string): When {
  const when: When = { lastMessageRole: "user", toolResults: [] };
  if (contains !== undefined) when.userTextContains = contains;
  return when;
}

/** The turn answers the results of every tool call of the turn before, in any order. */
export const results = (...expected: ToolResultExpectation[]): When => ({
  lastMessageRole: "tool",
  toolResults: expected,
});

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
export const ok = (callId: string, toolName: string, contains?: string) =>
  result(callId, toolName, false, contains);
export const refused = (callId: string, toolName: string, contains?: string) =>
  result(callId, toolName, true, contains);

export const say = (text: string): Reply => ({ text });
export const call = (
  id: string,
  name: string,
  args: Record<string, unknown>,
): Required<Pick<Reply, "toolCalls">> => ({
  toolCalls: [{ id, name, arguments: args }],
});
export const calls = (
  ...replies: Required<Pick<Reply, "toolCalls">>[]
): Reply => ({
  toolCalls: replies.flatMap((reply) => reply.toolCalls),
});
export const execute = (
  id: string,
  plugin: string,
  action: string,
  input: Record<string, unknown>,
) => call(id, "execute", { plugin, action, input });

export const turn = (
  when: When,
  reply: Reply,
  requiredTools?: string[],
): Turn =>
  requiredTools === undefined
    ? { when, reply }
    : { when, reply, requiredTools };

// The text and tool calls a recorded reply streams.
function decodeReply(sse: string): Reply {
  let text = "";
  const made: { id: string; name: string; args: string }[] = [];
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data: {")) continue;
    const chunk = OpenAISseChunk.assert(
      JSON.parse(line.slice("data: ".length)),
    );
    for (const choice of chunk.choices) {
      text += choice.delta.content ?? "";
      const parts = choice.delta.tool_calls;
      if (parts === undefined) continue;
      for (const part of parts) {
        const known = made[part.index];
        if (known) known.args += part.function.arguments;
        else
          made[part.index] = {
            id: part.id ?? "",
            name: part.function.name ?? "",
            args: part.function.arguments,
          };
      }
    }
  }
  const reply: Reply = {};
  if (text !== "") reply.text = text;
  if (made.length > 0)
    reply.toolCalls = made.map(({ id, name, args }) => ({
      id,
      name,
      arguments: type("Record<string, unknown>").assert(JSON.parse(args)),
    }));
  return reply;
}

/** The turns of one recorded run of the weather project in test/fixtures/pipeline. */
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

// check-stack runs the project's checks, which outlast run_shell's 30-second default on a busy
// machine, a first install most of all.
export const CHECK_STACK_MS = 180_000;

/** Recorded coder turns whose check-stack gets the longer time limit. */
export const withLongerCheck = (turns: readonly Turn[]): Turn[] =>
  turns.map(({ when, reply, requiredTools }) => {
    const longer: Reply = {};
    if (reply.text !== undefined) longer.text = reply.text;
    if (reply.toolCalls !== undefined)
      longer.toolCalls = reply.toolCalls.map((made) =>
        made.name === "run_shell" && made.arguments["command"] === "check-stack"
          ? {
              id: made.id,
              name: made.name,
              arguments: { command: "check-stack", timeout: CHECK_STACK_MS },
            }
          : made,
      );
    return turn(when, longer, requiredTools);
  });

// The tools each role must be offered in every turn, unless a turn names its own.
const REQUIRED_TOOLS: Record<AgentRole, string[]> = {
  coordinator: ["execute", "question"],
  writer: ["write_artifact"],
  designer: ["check_design"],
  coder: ["edit_file", "run_shell"],
  reviewer: [],
  presenter: [],
};

export type Run = Readonly<{ role: AgentRole; turns: readonly Turn[] }>;

// ---- The project ----

/**
 * idea: a new project whose coordinator is first sent the idea. seed: one of test/seed's projects
 * written straight into the database, as scripts/seed-projects.ts writes a project in the stored
 * shape of an earlier release, at its built stage, then given a coordinator. file: a project file
 * imported as the person imports one.
 */
export type Start =
  | Readonly<{ idea: string; title: string }>
  | Readonly<{ seed: SeedFixtureId }>
  | Readonly<{ file: ProjectExport }>;

type HubReply = Readonly<{ status: number; body: unknown }>;

const ToolResults = type({
  toolResults: type({
    callId: "string",
    isError: "boolean",
    text: "string",
  }).array(),
});
const Message = type({ user: "string" });
const RunActions = type({ plugin: "string", action: "string" }).array();

/**
 * Starts the scripted model and a hub, then the project. runs holds the coordinator's turns under
 * "coordinator", and each other run's, a replacing coordinator's among them, under a key of its own.
 */
export async function openProject(options: {
  start: Start;
  runs: Readonly<Record<string, Run>>;
}) {
  const fixtures = Object.entries(options.runs).map(
    ([runKey, { role, turns }]) => ({
      runKey,
      role,
      stage: runKey,
      sourceRunId: `scripted-${runKey}`,
      exchanges: turns.map(({ when, reply, requiredTools }) => {
        const expect: ExchangeExpectation = {
          lastMessageRole: when.lastMessageRole,
          requiredTools: requiredTools ?? REQUIRED_TOOLS[role],
          toolResults: when.toolResults,
        };
        if (when.userTextContains !== undefined)
          expect.userTextContains = when.userTextContains;
        return { sse: formatOpenAISseResponse(reply), expect };
      }),
    }),
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "builder-e2e-script-"));
  let model: RecordedModelServer | undefined;
  let hub: TestHubHandle | undefined;
  try {
    await writeScenarioFixture(
      fixtureDir,
      { scenario: "scripted", recordedFromCommit: "scripted" },
      fixtures,
    );
    model = await startRecordedModelServer(fixtureDir);
    hub = await startTestHub(model);
    return await driven(hub, model, options.start, fixtures, async () => {
      await hub?.close();
      await model?.stop();
      await rm(fixtureDir, { recursive: true, force: true });
    });
  } catch (error) {
    await hub?.close();
    await model?.stop();
    await rm(fixtureDir, { recursive: true, force: true });
    throw error;
  }
}

async function started(hub: TestHubHandle, start: Start) {
  const { client, workspaceTenantId } = hub;
  if ("idea" in start) {
    const projectId = `p-${crypto.randomUUID().slice(0, 8)}`;
    await client.mutateProject(workspaceTenantId, projectId, {
      mutationId: `mut-create-${projectId}`,
      idempotencyKey: `idem-create-${projectId}`,
      command: "create_project",
      payload: {
        title: start.title,
        profile: "recorded_replay",
        problemStatement: start.idea,
      },
    });
    return projectId;
  }
  if ("file" in start)
    return (await client.importProject(workspaceTenantId, { file: start.file }))
      .projectId;
  const { projects } = await runDevelopmentSeed(hub.env, {
    fixture: start.seed,
    stage: "shipped",
    tenantId: workspaceTenantId,
  });
  const [seeded] = projects;
  if (!seeded) throw new Error(`${start.seed} was not seeded`);
  await client.startProjectCoordinator(workspaceTenantId, seeded.projectId);
  return seeded.projectId;
}

async function driven(
  hub: TestHubHandle,
  model: RecordedModelServer,
  start: Start,
  fixtures: readonly { runKey: string; exchanges: readonly unknown[] }[],
  close: () => Promise<void>,
) {
  const { client, workspaceTenantId } = hub;
  const projectId = await started(hub, start);
  const listing = await client.project(workspaceTenantId, projectId);
  const tenantId = listing.tenantId;
  let coordinatorRunId = NonEmptyString.assert(listing.coordinatorRunId);
  const path = `/api/tenants/${tenantId}/projects/${projectId}`;

  const until = async <T>(
    what: string,
    check: () => Promise<T | undefined>,
  ) => {
    const deadline = performance.now() + DEADLINE_MS;
    while (performance.now() < deadline) {
      const failure = model.firstFailure();
      if (failure) throw failure;
      const found = await check();
      if (found !== undefined) return found;
      await Bun.sleep(POLL_MS);
    }
    throw new Error(`Timed out waiting for ${what}`);
  };

  /** A hub call as the person, or with the headers given instead; a refusal is returned, not thrown. */
  const callHub = async (
    method: "GET" | "POST" | "PUT" | "DELETE",
    target: string,
    body?: unknown,
    headers: Record<string, string> = {
      cookie: hub.cookie,
      origin: hub.baseUrl,
      "content-type": "application/json",
    },
  ): Promise<HubReply> => {
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(new URL(target, hub.baseUrl), init);
    const text = await response.text();
    const json = type("string.json.parse")(text);
    return {
      status: response.status,
      body: json instanceof type.errors ? text : json,
    };
  };

  const questions = async () =>
    (await client.conversationEvents(tenantId, projectId)).questions;

  const sent = () => model.exchanges();

  return {
    hub,
    tenantId,
    projectId,
    path,
    until,
    call: callHub,
    /** Sends the coordinator a message as the person. */
    say: async (text: string) => {
      await client.sendMessage(tenantId, coordinatorRunId, { content: text });
    },
    questions,
    /** Waits for the question the coordinator is waiting on. */
    question: () =>
      until("an open question", async () =>
        (await questions()).find((asked) => asked.status === "open"),
      ),
    /** Answers a question through the hub's answers route, as the person unless headers say otherwise. */
    answer: (
      signalName: string,
      answer: QuestionAnswer,
      headers?: Record<string, string>,
    ) => callHub("POST", `${path}/answers`, { signalName, answer }, headers),
    /** The project values by name, as the hub reads them. */
    values: async (names: readonly string[]) =>
      type({ values: "Record<string, unknown>" }).assert(
        (await callHub("GET", `${path}/values?keys=${names.join(",")}`)).body,
      ).values,
    artifacts: async () =>
      (await client.projectArtifacts(tenantId, projectId)).artifacts,
    /** Waits until a document of the kind is filed, at the version when given. */
    filed: (kind: string, version?: number): Promise<ProjectArtifact> =>
      until(`${kind} filed`, async () =>
        (await client.projectArtifacts(tenantId, projectId)).artifacts.find(
          (item) =>
            item.kind === kind &&
            (version === undefined || item.version === version),
        ),
      ),
    /** Waits until the coordinator says something containing the text. */
    heard: (text: string) =>
      until(`the coordinator to say ${JSON.stringify(text)}`, async () =>
        (await client.conversationEvents(tenantId, projectId)).turns?.find(
          (said) => said.role === "assistant" && said.text.includes(text),
        ),
      ),
    /** How many turns of a scripted run have been asked for so far. */
    asked: (runKey: string) =>
      sent().filter((exchange) => exchange.runKey === runKey).length,
    /** What a scripted tool call returned, as the model was sent it. */
    resultOf: (callId: string) => {
      for (const exchange of sent()) {
        const got = ToolResults(exchange.received);
        if (got instanceof type.errors) continue;
        const found = got.toolResults.find((item) => item.callId === callId);
        if (found) return found;
      }
      throw new Error(`No model turn was sent the result of ${callId}`);
    },
    /** Every message a scripted run was sent, its assignment or briefing first. */
    messages: (runKey: string) =>
      sent()
        .filter((exchange) => exchange.runKey === runKey)
        .flatMap((exchange) => {
          const message = Message(exchange.received);
          return message instanceof type.errors ? [] : [message.user];
        }),
    /** The plugin action each specialist run in the project was started for, in start order. */
    actionsRun: async () =>
      RunActions.assert(
        await hub.db.execute(
          sql`select plugin, action from sb_run_action where project_id = ${projectId} order by created_at`,
        ),
      ).map(({ plugin, action }) => `${plugin} ${action}`),
    /** Stops and starts the hub on the same database and data. */
    restart: () => hub.restart(),
    /** Archives and restores the project, which replaces its coordinator with a new run. */
    replaceCoordinator: async () => {
      await client.archiveProject(workspaceTenantId, projectId);
      await client.restoreProject(workspaceTenantId, projectId);
      const replaced = NonEmptyString.assert(
        (await client.project(workspaceTenantId, projectId)).coordinatorRunId,
      );
      if (replaced === coordinatorRunId)
        throw new Error("Restoring the project kept the same coordinator run");
      coordinatorRunId = replaced;
      return replaced;
    },
    /** Waits until every scripted turn has been asked for, then fails on any the model refused. */
    finish: async () => {
      await until(
        "every scripted turn to be asked for",
        async () =>
          fixtures.every(
            ({ runKey, exchanges }) =>
              sent().filter((exchange) => exchange.runKey === runKey).length >=
              exchanges.length,
          ) || undefined,
      );
      model.assertClean();
    },
    close,
  };
}

export type ScriptedProject = Awaited<ReturnType<typeof openProject>>;
