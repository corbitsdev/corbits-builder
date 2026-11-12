import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";

export type AgentRole =
  | "coordinator"
  | "designer"
  | "coder"
  | "presenter"
  | "writer"
  | "reviewer";

export const ToolResultExpectation = type({
  "+": "reject",
  callId: "string > 0",
  toolName: "string > 0",
  // Left out when either outcome is expected, such as which of two same-turn calls wins a race.
  "isError?": "boolean",
  "keys?": "string[]",
  "contains?": "string",
  "bind?": "Record<string, string>",
});
export type ToolResultExpectation = typeof ToolResultExpectation.infer;
export const ExpectedToolResult = ToolResultExpectation;
export type ExpectedToolResult = ToolResultExpectation;

export const ExchangeExpectation = type({
  "+": "reject",
  lastMessageRole: "'user' | 'tool'",
  "userTextContains?": "string",
  requiredTools: "string[]",
  toolResults: ToolResultExpectation.array(),
});
export type ExchangeExpectation = typeof ExchangeExpectation.infer;

export const SessionManifest = type({
  "+": "reject",
  runKey: "string > 0",
  role: "string > 0",
  stage: "string > 0",
  sourceRunId: "string > 0",
  exchangeCount: "number.integer >= 0",
});
export type SessionManifest = typeof SessionManifest.infer;

export const ScenarioManifest = type({
  "+": "reject",
  scenario: "string > 0",
  recordedFromCommit: "string > 0",
  runs: SessionManifest.array(),
});
export type ScenarioManifest = typeof ScenarioManifest.infer;

export const ResponseHeaders = type("Record<string, string>");
export type ResponseHeaders = typeof ResponseHeaders.infer;

const OpenAIMessageContentPart = type({
  "type?": "string",
  "text?": "string",
});

export const OpenAIChatMessage = type({
  role: "string > 0",
  "content?": type("string")
    .or(OpenAIMessageContentPart.or("string").array())
    .or("null"),
  "tool_call_id?": "string",
  "tool_calls?": type({
    "id?": "string",
    "type?": "string",
    "function?": {
      "name?": "string",
      "arguments?": "string",
    },
  }).array(),
});
export type OpenAIChatMessage = typeof OpenAIChatMessage.infer;

export const OpenAIToolSpec = type({
  "type?": "string",
  "function?": {
    "name?": "string",
  },
});
export type OpenAIToolSpec = typeof OpenAIToolSpec.infer;

export const OpenAIChatRequest = type({
  "model?": "string",
  messages: OpenAIChatMessage.array(),
  "tools?": OpenAIToolSpec.array(),
});
export type OpenAIChatRequest = typeof OpenAIChatRequest.infer;

export const OpenAISseDelta = type({
  "role?": "'assistant'",
  "content?": "string",
  "tool_calls?": type({
    index: "number.integer >= 0",
    "id?": "string",
    function: {
      "name?": "string",
      arguments: "string",
    },
  }).array(),
});
export type OpenAISseDelta = typeof OpenAISseDelta.infer;

export const OpenAISseChunk = type({
  choices: type({
    index: "number.integer >= 0",
    delta: OpenAISseDelta,
    finish_reason: "'tool_calls' | 'stop' | null",
  }).array(),
  "usage?": {
    prompt_tokens: "number.integer >= 0",
    completion_tokens: "number.integer >= 0",
  },
});
export type OpenAISseChunk = typeof OpenAISseChunk.infer;

const JsonRecord = type("Record<string, unknown>");
const ScalarBindingValue = type("string | number");
const StringValue = type("string");

export type RecordedExchange = Readonly<{
  index: number;
  responseSse: string;
  responseHeaders: ResponseHeaders;
  // The HTTP status the model answers with; a failing one answers with an error body instead.
  status: number;
  expect: ExchangeExpectation;
}>;

export type RecordedRunBundle = Readonly<{
  runKey: string;
  role: string;
  stage: string;
  sourceRunId: string;
  exchanges: readonly RecordedExchange[];
}>;

// What the model was sent last in one request: the person's or the host's message, or the results
// of the tool calls it made the turn before.
export type ModelReceived =
  | Readonly<{ user: string }>
  | Readonly<{
      toolResults: readonly Readonly<{
        callId: string;
        isError: boolean;
        text: string;
      }>[];
    }>;

/** One request the model answered or refused, in the order they arrived. */
export type ModelExchange = Readonly<{
  at: number;
  role: string;
  runKey?: string;
  index?: number;
  received: ModelReceived;
  responseSse?: string;
  // The HTTP status a scripted turn answered with.
  status?: number;
  failure?: string;
}>;

export type RecordedModelServer = Readonly<{
  url: string;
  scenario: string;
  assertClean: () => void;
  firstFailure: () => Error | undefined;
  onActivity: (listener: () => void) => () => void;
  exchanges: () => readonly ModelExchange[];
  stop: () => Promise<void>;
}>;

function messageText(content: OpenAIChatMessage["content"]): string {
  if (content === undefined || content === null) return "";
  const direct = StringValue(content);
  if (!(direct instanceof type.errors)) return direct;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const textPart = StringValue(part);
      if (!(textPart instanceof type.errors)) return textPart;
      const objPart = OpenAIMessageContentPart(part);
      if (!(objPart instanceof type.errors) && objPart.text) {
        return objPart.text;
      }
      return "";
    })
    .join("\n");
}

function receivedIn(messages: readonly OpenAIChatMessage[]): ModelReceived {
  const last = messages.at(-1);
  if (last?.role !== "tool") return { user: messageText(last?.content) };
  const trailing: OpenAIChatMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === "tool"; i--)
    trailing.unshift(messages[i]!);
  return {
    toolResults: trailing.map((message) => {
      const text = messageText(message.content);
      const isError =
        text.startsWith("<error>\n") && text.endsWith("\n</error>");
      return {
        callId: message.tool_call_id ?? "",
        isError,
        text: isError
          ? text.slice("<error>\n".length, -"\n</error>".length)
          : text,
      };
    }),
  };
}

function offeredToolNames(req: OpenAIChatRequest): string[] {
  if (!req.tools) return [];
  const names: string[] = [];
  for (const tool of req.tools) {
    if (tool.function?.name) {
      names.push(tool.function.name);
    }
  }
  return names;
}

export function classifyRole(
  req: OpenAIChatRequest,
  tools: ReadonlySet<string>,
): AgentRole | undefined {
  if (tools.has("execute")) return "coordinator";
  if (tools.has("file_design_option") || tools.has("check_design")) {
    return "designer";
  }
  if (tools.has("app_status") || tools.has("install_packages")) {
    return "coder";
  }
  if (tools.has("write_deck") || tools.has("file_package")) {
    return "presenter";
  }
  if (tools.has("write_artifact")) {
    return "writer";
  }
  const sys = req.messages.find((m) => m.role === "system");
  if (messageText(sys?.content).includes("document reviewer")) {
    return "reviewer";
  }
  return undefined;
}

function readPathValue(obj: unknown, dotPath: string): string | undefined {
  let cursor: unknown = obj;
  for (const part of dotPath.split(".")) {
    if (Array.isArray(cursor)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    const record = JsonRecord(cursor);
    if (record instanceof type.errors) return undefined;
    cursor = record[part];
  }
  const scalar = ScalarBindingValue(cursor);
  if (scalar instanceof type.errors) return undefined;
  return String(scalar);
}

function substituteBindings(
  sse: string,
  bindings: ReadonlyMap<string, string>,
  context: {
    scenario: string;
    stage: string;
    runKey: string;
    exchange: number;
  },
): string {
  return sse.replace(
    /\{\{bind:([a-zA-Z0-9_.:-]+)\}\}/g,
    (_match, key: string) => {
      const resolved = bindings.get(key);
      if (resolved === undefined) {
        const known =
          bindings.size > 0 ? [...bindings.keys()].join(", ") : "(none)";
        throw new Error(
          [
            `Recorded model binding missing in scenario "${context.scenario}"`,
            `  stage: ${context.stage}`,
            `  run: ${context.runKey} (exchange ${context.exchange})`,
            `  missing placeholder: {{bind:${key}}}`,
            `  known bindings: ${known}`,
            `  re-record: bun --conditions=intx-src test/e2e/support/extract.ts`,
          ].join("\n"),
        );
      }
      return resolved;
    },
  );
}

export async function loadScenarioBundle(
  fixtureDir: string,
): Promise<{ manifest: ScenarioManifest; runs: readonly RecordedRunBundle[] }> {
  const manifest = ScenarioManifest.assert(
    JSON.parse(await readFile(join(fixtureDir, "scenario.json"), "utf8")),
  );
  const runs: RecordedRunBundle[] = [];
  for (const entry of manifest.runs) {
    const runDir = join(fixtureDir, "runs", entry.runKey);
    const session = SessionManifest.assert(
      JSON.parse(await readFile(join(runDir, "session.json"), "utf8")),
    );
    const exchangeDirs = (await readdir(join(runDir, "exchanges"))).sort(
      (a, b) => Number(a) - Number(b),
    );
    const exchanges: RecordedExchange[] = [];
    for (const dir of exchangeDirs) {
      const idx = Number(dir);
      const exchPath = join(runDir, "exchanges", dir);
      const [responseSse, responseHeadersRaw, expectRaw] = await Promise.all([
        readFile(join(exchPath, "response.sse"), "utf8"),
        readFile(join(exchPath, "response-headers.json"), "utf8"),
        readFile(join(exchPath, "expect.json"), "utf8"),
      ]);
      const status = Bun.file(join(exchPath, "status.json"));
      exchanges.push({
        index: idx,
        responseSse,
        responseHeaders: ResponseHeaders.assert(JSON.parse(responseHeadersRaw)),
        status: (await status.exists())
          ? type("number.integer").assert(await status.json())
          : 200,
        expect: ExchangeExpectation.assert(JSON.parse(expectRaw)),
      });
    }
    if (exchanges.length !== session.exchangeCount) {
      throw new Error(
        `Run "${entry.runKey}" session.json expected ${session.exchangeCount} exchanges, found ${exchanges.length}`,
      );
    }
    runs.push({
      runKey: session.runKey,
      role: session.role,
      stage: session.stage,
      sourceRunId: session.sourceRunId,
      exchanges,
    });
  }
  return { manifest, runs };
}

export async function startRecordedModelServer(
  fixtureDir: string,
): Promise<RecordedModelServer> {
  const { manifest, runs } = await loadScenarioBundle(fixtureDir);
  const cursors = new Map<string, number>(runs.map((r) => [r.runKey, 0]));
  const bindings = new Map<string, string>();
  const listeners = new Set<() => void>();
  const log: ModelExchange[] = [];
  let failure: Error | undefined;

  function cursorFor(runKey: string): number {
    const value = cursors.get(runKey);
    if (value === undefined) {
      throw new Error(`Unknown recorded run "${runKey}"`);
    }
    return value;
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function recordFailure(message: string): Error {
    const err = new Error(message);
    if (!failure) failure = err;
    notify();
    return err;
  }

  function selectRun(
    role: string,
    messages: readonly OpenAIChatMessage[],
  ): RecordedRunBundle {
    const candidates = runs.filter((r) => r.role === role);
    const assistantCount = messages.filter(
      (m) => m.role === "assistant",
    ).length;

    if (assistantCount === 0) {
      const unstarted = candidates.filter((r) => cursorFor(r.runKey) === 0);
      const lastMsg = messages.at(-1);
      const lastText = messageText(lastMsg?.content);
      const matched = unstarted.find((r) => {
        const first = r.exchanges[0];
        if (!first?.expect.userTextContains) return true;
        return lastText.includes(first.expect.userTextContains);
      });
      const picked = matched ?? unstarted[0];
      if (!picked) {
        throw recordFailure(
          [
            `Recorded model received an unexpected new "${role}" run in scenario "${manifest.scenario}"`,
            `  last user message: ${JSON.stringify(lastText.slice(0, 200))}`,
            `  re-record: bun --conditions=intx-src test/e2e/support/extract.ts`,
          ].join("\n"),
        );
      }
      return picked;
    }

    const active = candidates.find((r) => {
      const cur = cursorFor(r.runKey);
      return cur > 0 && cur < r.exchanges.length && cur === assistantCount;
    });
    if (active) return active;

    const remaining = candidates.find(
      (r) => cursorFor(r.runKey) < r.exchanges.length,
    );
    if (!remaining) {
      throw recordFailure(
        [
          `Recorded model has no remaining exchanges for role "${role}" in scenario "${manifest.scenario}"`,
          `  assistant turns in request: ${assistantCount}`,
          `  re-record: bun --conditions=intx-src test/e2e/support/extract.ts`,
        ].join("\n"),
      );
    }
    return remaining;
  }

  function verifyExpectation(
    run: RecordedRunBundle,
    exchange: RecordedExchange,
    req: OpenAIChatRequest,
    offered: ReadonlySet<string>,
  ): void {
    const messages = req.messages;
    const last = messages.at(-1);
    const actualRole = last ? last.role : "(none)";
    const ctx = [
      `  scenario: ${manifest.scenario}`,
      `  stage: ${run.stage}`,
      `  run: ${run.runKey} (source ${run.sourceRunId})`,
      `  exchange: ${exchange.index}`,
      `  re-record: bun --conditions=intx-src test/e2e/support/extract.ts`,
    ].join("\n");

    if (actualRole !== exchange.expect.lastMessageRole) {
      throw recordFailure(
        `Recorded model request role mismatch:\n${ctx}\n  expected lastMessageRole: ${exchange.expect.lastMessageRole}\n  actual lastMessageRole: ${actualRole}`,
      );
    }

    for (const requiredTool of exchange.expect.requiredTools) {
      if (!offered.has(requiredTool)) {
        throw recordFailure(
          `Recorded model missing required tool "${requiredTool}":\n${ctx}\n  offered tools: ${[...offered].sort().join(", ")}`,
        );
      }
    }

    if (
      exchange.expect.lastMessageRole === "user" &&
      exchange.expect.userTextContains
    ) {
      const text = messageText(last?.content);
      if (!text.includes(exchange.expect.userTextContains)) {
        throw recordFailure(
          `Recorded model user prompt mismatch:\n${ctx}\n  expected substring: ${JSON.stringify(exchange.expect.userTextContains)}\n  actual text: ${JSON.stringify(text.slice(0, 300))}`,
        );
      }
    }

    if (exchange.expect.toolResults.length > 0) {
      const trailingTools: OpenAIChatMessage[] = [];
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const msg = messages[i]!;
        if (msg.role === "tool") {
          trailingTools.unshift(msg);
        } else {
          break;
        }
      }

      if (trailingTools.length !== exchange.expect.toolResults.length) {
        throw recordFailure(
          `Recorded model tool result count mismatch:\n${ctx}\n  expected: ${exchange.expect.toolResults.length} (${exchange.expect.toolResults.map((t) => `${t.toolName}:${t.callId}`).join(", ")})\n  actual: ${trailingTools.length} (${trailingTools.map((t) => t.tool_call_id).join(", ")})`,
        );
      }

      for (const expected of exchange.expect.toolResults) {
        const actual = trailingTools.find(
          (m) => m.tool_call_id === expected.callId,
        );
        if (!actual) {
          throw recordFailure(
            `Recorded model missing tool result for callId "${expected.callId}" (${expected.toolName}):\n${ctx}\n  actual tool_call_ids: ${trailingTools.map((t) => t.tool_call_id).join(", ")}`,
          );
        }
        const rawText = messageText(actual.content);
        const actualIsError =
          rawText.startsWith("<error>\n") && rawText.endsWith("\n</error>");
        const unwrapped = actualIsError
          ? rawText.slice("<error>\n".length, -"\n</error>".length)
          : rawText;

        if (
          expected.isError !== undefined &&
          actualIsError !== expected.isError
        ) {
          throw recordFailure(
            `Recorded model tool result isError mismatch for ${expected.toolName} (${expected.callId}):\n${ctx}\n  expected isError: ${expected.isError}\n  actual isError: ${actualIsError}\n  actual content: ${unwrapped.slice(0, 2000)}`,
          );
        }

        if (expected.contains && !unwrapped.includes(expected.contains)) {
          throw recordFailure(
            `Recorded model tool result content mismatch for ${expected.toolName} (${expected.callId}):\n${ctx}\n  expected substring: ${JSON.stringify(expected.contains)}\n  actual content: ${JSON.stringify(unwrapped.slice(0, 2000))}`,
          );
        }

        if (expected.keys || expected.bind) {
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(unwrapped);
          } catch (cause) {
            throw recordFailure(
              `Recorded model expected JSON tool result for ${expected.toolName} (${expected.callId}, ${String(cause)}):\n${ctx}\n  actual content: ${JSON.stringify(unwrapped.slice(0, 2000))}`,
            );
          }
          if (expected.keys && expected.keys.length > 0) {
            const obj = JsonRecord(parsedJson);
            if (obj instanceof type.errors || Array.isArray(parsedJson)) {
              throw recordFailure(
                `Recorded model expected JSON object for ${expected.toolName} (${expected.callId}):\n${ctx}\n  actual content: ${JSON.stringify(unwrapped.slice(0, 400))}`,
              );
            }
            for (const key of expected.keys) {
              if (!(key in obj)) {
                throw recordFailure(
                  `Recorded model tool result missing key "${key}" for ${expected.toolName} (${expected.callId}):\n${ctx}\n  expected keys: ${expected.keys.join(", ")}\n  actual keys: ${Object.keys(obj).join(", ")}`,
                );
              }
            }
          }
          if (expected.bind) {
            for (const [bindName, jsonPath] of Object.entries(expected.bind)) {
              const val = readPathValue(parsedJson, jsonPath);
              if (val === undefined) {
                throw recordFailure(
                  `Recorded model could not extract binding "${bindName}" at path "${jsonPath}" from ${expected.toolName} (${expected.callId}):\n${ctx}\n  actual JSON: ${unwrapped.slice(0, 400)}`,
                );
              }
              bindings.set(bindName, val);
            }
          }
        }
      }
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname.endsWith("/models")) {
        return Response.json({
          object: "list",
          data: [{ id: "recorded-replay", object: "model" }],
        });
      }
      if (
        request.method !== "POST" ||
        !url.pathname.endsWith("/chat/completions")
      ) {
        return new Response("not found", { status: 404 });
      }
      let role = "unknown";
      let received: ModelReceived = { user: "" };
      try {
        const parsedBody = OpenAIChatRequest(await request.json());
        if (parsedBody instanceof type.errors) {
          throw recordFailure(
            `Recorded model received invalid OpenAI chat request in scenario "${manifest.scenario}": ${parsedBody.summary}`,
          );
        }
        received = receivedIn(parsedBody.messages);
        const offered = new Set(offeredToolNames(parsedBody));
        const classified = classifyRole(parsedBody, offered);
        if (!classified) {
          throw recordFailure(
            `Recorded model could not classify role from tools [${[...offered].join(", ")}] in scenario "${manifest.scenario}"`,
          );
        }
        role = classified;
        const run = selectRun(role, parsedBody.messages);
        const cursor = cursorFor(run.runKey);
        const exchange = run.exchanges[cursor];
        if (!exchange) {
          throw recordFailure(
            `Recorded model exhausted exchanges for run "${run.runKey}" at index ${cursor} in scenario "${manifest.scenario}"`,
          );
        }
        verifyExpectation(run, exchange, parsedBody, offered);
        const sse = substituteBindings(exchange.responseSse, bindings, {
          scenario: manifest.scenario,
          stage: run.stage,
          runKey: run.runKey,
          exchange: exchange.index,
        });
        cursors.set(run.runKey, cursor + 1);
        log.push({
          at: Date.now(),
          role,
          runKey: run.runKey,
          index: exchange.index,
          received,
          responseSse: sse,
          status: exchange.status,
        });
        notify();
        return new Response(sse, {
          status: exchange.status,
          headers: exchange.responseHeaders,
        });
      } catch (error) {
        const err =
          error instanceof Error ? error : recordFailure(String(error));
        if (!failure) failure = err;
        log.push({ at: Date.now(), role, received, failure: err.message });
        notify();
        return Response.json(
          { error: { message: err.message, type: "recorded_model_mismatch" } },
          { status: 500 },
        );
      }
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    scenario: manifest.scenario,
    firstFailure: () => failure,
    exchanges: () => log,
    onActivity: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    assertClean: () => {
      if (failure) throw failure;
      const unconsumed: string[] = [];
      for (const run of runs) {
        const used = cursorFor(run.runKey);
        if (used !== run.exchanges.length) {
          unconsumed.push(
            `${run.runKey} (${run.stage}): consumed ${used}/${run.exchanges.length}`,
          );
        }
      }
      if (unconsumed.length > 0) {
        throw new Error(
          `Recorded model has unconsumed exchanges in scenario "${manifest.scenario}":\n  ${unconsumed.join("\n  ")}`,
        );
      }
    },
    stop: async () => {
      await server.stop(true);
    },
  };
}

export function formatOpenAISseResponse(turn: {
  text?: string;
  toolCalls?: readonly {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
}): string {
  const chunks: OpenAISseChunk[] = [
    {
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
    },
  ];
  if (turn.text) {
    chunks.push({
      choices: [
        { index: 0, delta: { content: turn.text }, finish_reason: null },
      ],
    });
  }
  const hasToolCalls =
    turn.toolCalls !== undefined && turn.toolCalls.length > 0;
  if (turn.toolCalls) {
    for (let i = 0; i < turn.toolCalls.length; i += 1) {
      const call = turn.toolCalls[i]!;
      chunks.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  id: call.id,
                  function: { name: call.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      chunks.push({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: i,
                  function: { arguments: JSON.stringify(call.arguments) },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
    }
  }
  chunks.push({
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: hasToolCalls ? "tool_calls" : "stop",
      },
    ],
  });
  chunks.push({
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 60 },
  });
  return `${chunks.map((c) => `data: ${JSON.stringify(OpenAISseChunk.assert(c))}\n\n`).join("")}data: [DONE]\n\n`;
}

export type ScenarioRunFixtureSpec = Readonly<{
  runKey: string;
  role: AgentRole;
  stage: string;
  sourceRunId: string;
  exchanges: readonly {
    sse: string;
    expect: ExchangeExpectation;
    // A failing HTTP status to answer with, sse then being the error body.
    status?: number;
  }[];
}>;

export async function writeScenarioFixture(
  root: string,
  meta: { scenario: string; recordedFromCommit: string },
  runs: readonly ScenarioRunFixtureSpec[],
): Promise<void> {
  const manifest: ScenarioManifest = {
    scenario: meta.scenario,
    recordedFromCommit: meta.recordedFromCommit,
    runs: runs.map((run) => ({
      runKey: run.runKey,
      role: run.role,
      stage: run.stage,
      sourceRunId: run.sourceRunId,
      exchangeCount: run.exchanges.length,
    })),
  };
  await writeFile(
    join(root, "scenario.json"),
    JSON.stringify(manifest, null, 2),
  );
  for (const run of runs) {
    const runDir = join(root, "runs", run.runKey);
    await mkdir(runDir, { recursive: true });
    const session: SessionManifest = {
      runKey: run.runKey,
      role: run.role,
      stage: run.stage,
      sourceRunId: run.sourceRunId,
      exchangeCount: run.exchanges.length,
    };
    await writeFile(
      join(runDir, "session.json"),
      JSON.stringify(session, null, 2),
    );
    await writeFile(
      join(runDir, "key.json"),
      JSON.stringify(
        {
          role: run.role,
          stage: run.stage,
          sourceRunId: run.sourceRunId,
        },
        null,
        2,
      ),
    );
    for (let i = 0; i < run.exchanges.length; i += 1) {
      const exDir = join(runDir, "exchanges", String(i));
      const { status } = run.exchanges[i]!;
      await mkdir(exDir, { recursive: true });
      await writeFile(join(exDir, "response.sse"), run.exchanges[i]!.sse);
      await writeFile(
        join(exDir, "response-headers.json"),
        JSON.stringify({
          "content-type":
            status === undefined
              ? "text/event-stream; charset=utf-8"
              : "application/json",
        }),
      );
      if (status !== undefined)
        await writeFile(join(exDir, "status.json"), JSON.stringify(status));
      await writeFile(
        join(exDir, "expect.json"),
        JSON.stringify(run.exchanges[i]!.expect, null, 2),
      );
    }
  }
}
