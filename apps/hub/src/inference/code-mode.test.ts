import { expect, test } from "bun:test";
import type {
  ConversationTurn,
  LastCycleSource,
  ToolDefinition,
} from "@intx/types/runtime";
import { createCodexResponsesAdapter } from "./codex-adapter.ts";
import { scriptCall } from "./code-mode.ts";

const source: LastCycleSource = {
  sourceId: "codex-default",
  provider: "codex",
  model: "gpt-6.1-terra",
};
const quirks = {
  productName: "Corbits Builder",
  environmentTagName: "builder_environment",
};
const readArtifact = {
  name: "read_artifact",
  description: "See which project documents exist, or read one.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "The document kind." },
      part: { type: "integer" },
    },
    required: ["kind"],
  },
};
const tools = [
  readArtifact,
  {
    name: "ask_questions",
    description: "Ask the person questions.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { enum: ["single", "multi"] },
            },
            required: ["id", "kind"],
          },
        },
      },
      required: ["questions"],
    },
  },
];
const user: ConversationTurn = {
  role: "user",
  content: [{ type: "text", text: "Are you there?" }],
  timestamp: 0,
};

function build(
  messages: ConversationTurn[] = [user],
  requestTools: ToolDefinition[] = tools,
) {
  const adapter = createCodexResponsesAdapter(source, quirks);
  const request = adapter.buildRequest(messages, "gpt-6.1-terra", {
    tools: requestTools,
  });
  return { adapter, body: JSON.parse(request.body) };
}

function done(input: string) {
  return JSON.stringify({
    type: "response.output_item.done",
    sequence_number: 4,
    output_index: 1,
    item: {
      type: "custom_tool_call",
      id: "ctc_1",
      call_id: "call_1",
      name: "exec",
      input,
    },
  });
}

function toolCalls(events: { type: string; data: unknown }[]) {
  const calls: { callId: unknown; name: unknown; args: string }[] = [];
  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    if (event.type === "inference.tool_call.start")
      calls.push({ callId: data["callId"], name: data["name"], args: "" });
    if (event.type === "inference.tool_call.delta") {
      const last = calls.at(-1);
      if (last) last.args += String(data["argumentFragment"]);
    }
  }
  return calls.map(({ args, ...call }) => ({
    ...call,
    args: JSON.parse(args),
  }));
}

test("offers the tools as one exec code tool with a typed declaration for each", () => {
  const { body } = build();
  expect(body.tools).toHaveLength(1);
  const [exec] = body.tools;
  expect(exec).toMatchObject({
    type: "custom",
    name: "exec",
    format: { type: "grammar", syntax: "lark" },
  });
  expect(exec.description).toContain(
    "  read_artifact(args: {\n    // The document kind.\n    kind: string;\n    part?: number;\n  }): Promise<unknown>;",
  );
  expect(exec.description).toContain(
    'questions: Array<{\n      id: string;\n      kind: "single" | "multi";\n    }>;',
  );
  expect(body.parallel_tool_calls).toBe(true);
});

test("replays past tool calls as exec scripts and their outputs", () => {
  const { body } = build([
    user,
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call_9",
          name: "read_artifact",
          arguments: { kind: "problem_brief" },
        },
      ],
      timestamp: 1,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call_9",
          content: [{ type: "text", text: '{"version":1}' }],
        },
      ],
      timestamp: 2,
    },
  ]);
  expect(body.input).toContainEqual({
    type: "custom_tool_call",
    call_id: "call_9",
    name: "exec",
    input:
      'const result = await tools.read_artifact({"kind":"problem_brief"});\ntext(result);\n',
  });
  expect(body.input).toContainEqual({
    type: "custom_tool_call_output",
    call_id: "call_9",
    output: 'Script completed\nOutput:\n{"version":1}',
  });
});

test("turns the tool call in a script into an ordinary tool call", () => {
  const { adapter } = build();
  const events = adapter.parseResponse(
    done(
      "// Ask about access\nconst q = await tools.ask_questions({questions: [{id: \"access\", kind: 'single',}]});\ntext(JSON.stringify(q));\n",
    ),
  );
  expect(toolCalls(events)).toEqual([
    {
      callId: "call_1",
      name: "ask_questions",
      args: { questions: [{ id: "access", kind: "single" }] },
    },
  ]);
});

test("replays a call to a tool no longer offered under its decoded alias", () => {
  const { body } = build([
    user,
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call_9",
          name: "exa.web_search_exa",
          arguments: { query: "bun" },
        },
      ],
      timestamp: 1,
    },
  ]);
  expect(body.input).toContainEqual(
    expect.objectContaining({
      call_id: "call_9",
      input: expect.stringContaining("await tools.exa_web_search_exa({"),
    }),
  );
});

test("replays a failed tool call as a failed script", () => {
  const { body } = build([
    user,
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call_9",
          name: "read_artifact",
          arguments: { kind: "nope" },
        },
      ],
      timestamp: 1,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call_9",
          content: [{ type: "text", text: "no such document" }],
          isError: true,
        },
      ],
      timestamp: 2,
    },
  ]);
  expect(body.input).toContainEqual({
    type: "custom_tool_call_output",
    call_id: "call_9",
    output: "Script failed\nError:\nno such document",
  });
});

test("emits one tool call across the whole Codex event sequence", () => {
  const { adapter } = build();
  const item = {
    type: "custom_tool_call",
    id: "ctc_1",
    call_id: "call_1",
    name: "exec",
    input: "await tools.read_artifact({kind: 'a'});",
  };
  const events = [
    { type: "response.created", response: { id: "resp_1" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, input: "" },
    },
    {
      type: "response.custom_tool_call_input.delta",
      item_id: "ctc_1",
      delta: "await",
    },
    {
      type: "response.custom_tool_call_input.done",
      item_id: "ctc_1",
      input: item.input,
    },
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: "resp_1",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ].flatMap((event) => adapter.parseResponse(JSON.stringify(event)));
  expect(toolCalls(events)).toEqual([
    { callId: "call_1", name: "read_artifact", args: { kind: "a" } },
  ]);
});

test("turns parallel scripts in one response into separate tool calls", () => {
  const { adapter } = build();
  const second = JSON.parse(done("await tools.read_artifact({kind: 'b'});"));
  second.output_index = 2;
  second.item = { ...second.item, id: "ctc_2", call_id: "call_2" };
  const events = [
    ...adapter.parseResponse(done("await tools.read_artifact({kind: 'a'});")),
    ...adapter.parseResponse(JSON.stringify(second)),
  ];
  expect(toolCalls(events)).toEqual([
    { callId: "call_1", name: "read_artifact", args: { kind: "a" } },
    { callId: "call_2", name: "read_artifact", args: { kind: "b" } },
  ]);
});

test("waits for the finished script before emitting tool calls", () => {
  const { adapter } = build();
  const added = JSON.stringify({
    type: "response.output_item.added",
    sequence_number: 2,
    output_index: 1,
    item: {
      type: "custom_tool_call",
      id: "ctc_1",
      call_id: "call_1",
      name: "exec",
      input: "",
    },
  });
  expect(adapter.parseResponse(added)).toEqual([]);
});

test("sends a script it cannot read as one exec call, answered with how to call tools", () => {
  const { adapter } = build();
  const script = "text(ALL_TOOLS.map((t) => t.name));\n";
  expect(toolCalls(adapter.parseResponse(done(script)))).toEqual([
    { callId: "call_1", name: "exec", args: { script } },
  ]);

  const { body } = build([
    user,
    {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "call_1",
          name: "exec",
          arguments: { script },
        },
      ],
      timestamp: 1,
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "call_1",
          content: [{ type: "text", text: "unknown tool: exec" }],
          isError: true,
        },
      ],
      timestamp: 2,
    },
  ]);
  expect(body.input).toContainEqual({
    type: "custom_tool_call",
    call_id: "call_1",
    name: "exec",
    input: script,
  });
  const output = body.input.find(
    (item: { type: string }) => item.type === "custom_tool_call_output",
  );
  expect(output.output).toContain("await tools.<name>({...})");
});

test("reads a script only when it is one call to a known tool with a literal argument", () => {
  const names = new Map([
    ["read_artifact", "read_artifact"],
    ["write_file", "write_file"],
  ]);
  expect(
    scriptCall(
      '/* tools.write_file({}) */\nconst result = await tools.read_artifact({kind: "a (b); c", // note\n part: 1});\ntext(result)',
      names,
    ),
  ).toEqual({
    name: "read_artifact",
    arguments: { kind: "a (b); c", part: 1 },
  });
  expect(
    scriptCall(
      "await tools.write_file({path: 'a.ts', content: `one\n\"two\" \\`three\\``});",
      names,
    ),
  ).toEqual({
    name: "write_file",
    arguments: { path: "a.ts", content: 'one\n"two" `three`' },
  });
  expect(
    scriptCall(
      "await tools.write_file({content: `const x = \\`hi \\${name}\\`; \\u{1F600}`});",
      names,
    ),
  ).toEqual({
    name: "write_file",
    arguments: { content: "const x = `hi ${name}`; \u{1F600}" },
  });
  expect(
    scriptCall("await tools.write_file({content: `a\r\nb\rc\\\r\nd`});", names),
  ).toEqual({ name: "write_file", arguments: { content: "a\nb\ncd" } });
  expect(
    scriptCall(
      "await tools.write_file({path: '\\u{1F600}\\u{27}\\\\u{41}', content: \"\\u{22}\"});",
      names,
    ),
  ).toEqual({
    name: "write_file",
    arguments: { path: "\u{1F600}'\\u{41}", content: '"' },
  });
  expect(
    scriptCall("await tools.write_file({path: '\\u{110000}'});", names),
  ).toBeUndefined();
  const accepted = [
    "const r = await tools.read_artifact({});\ntext(r.content);",
    "const r = await tools.read_artifact({});\nconsole.log(r?.items[0]);",
    "await tools.read_artifact({});\ntext('done; tools.write_file({})');",
    "const r =\n  await tools.read_artifact({});\ntext(JSON.stringify(r, null, 2));",
  ];
  for (const script of accepted)
    expect(scriptCall(script, names)).toEqual({
      name: "read_artifact",
      arguments: {},
    });
  const refused = [
    "await tools.delete_everything({})",
    "await tools.read_artifact({kind: x})",
    "await tools.read_artifact({kind: (() => 1)()})",
    "await tools.write_file({content: `${x}`})",
    "await mytools.read_artifact({})",
    "await globalThis.tools.read_artifact({})",
    "await tools.read_artifact({}); await tools.write_file({});",
    'if (false) { await tools.write_file({path: "a"}); }',
    "try { await tools.read_artifact({}); } catch { await tools.write_file({}); }",
    "for (let i = 0; i < 3; i++) await tools.read_artifact({});",
    'const s = "x".replace(/\'/g, ""); await tools.read_artifact({});',
    "text(await tools.read_artifact({}))",
    'await tools.read_artifact({});\ntext(await tools["write_file"]({path: "x"}));',
    'await tools.read_artifact({});\ntext(await write_file({path: "x"}));',
    'await tools.read_artifact({});\nconsole.log(await tools?.write_file({path: "x"}));',
    "await tools.read_artifact({});\ntext(/'/.source); await tools .write_file({path: \"x\"}); text('')",
    "await read_artifact({})",
    "const r = await tools.read_artifact({});\ntext(r.map((x) => x));",
    "await tools.read_artifact({});\ntext(`${await tools.write_file({})}`);",
    "text(ALL_TOOLS)",
  ];
  for (const script of refused)
    expect(scriptCall(script, names)).toBeUndefined();
});

test("reads a large script in linear time", () => {
  const slide = "{title: 'Slide', points: [1, 2, 3], layout: {columns: 2}},\n";
  const script = `await tools.write_deck({slides: [\n${slide.repeat(8000)}]});`;
  const started = performance.now();
  expect(
    scriptCall(script, new Map([["write_deck", "write_deck"]])),
  ).toBeDefined();
  expect(performance.now() - started).toBeLessThan(500);
});

test("turns code tool calls in a buffered response into tool calls", () => {
  const { adapter } = build();
  const events = adapter.parseJSONResponse(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "custom_tool_call",
          id: "ctc_1",
          call_id: "call_1",
          name: "exec",
          input: "await tools.read_artifact({kind: 'problem_brief'});",
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
  expect(toolCalls(events)).toEqual([
    {
      callId: "call_1",
      name: "read_artifact",
      args: { kind: "problem_brief" },
    },
  ]);
});

test("offers tools with dotted names under an identifier alias", () => {
  const search = {
    name: "exa.web_search_exa",
    description: "Search the web.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  };
  const { adapter, body } = build([user], [readArtifact, search]);
  expect(body.tools).toHaveLength(1);
  expect(body.tools[0].description).toContain("  exa_web_search_exa(args: {");
  const events = adapter.parseResponse(
    done('await tools.exa_web_search_exa({query: "bun"});'),
  );
  expect(toolCalls(events)).toEqual([
    { callId: "call_1", name: "exa.web_search_exa", args: { query: "bun" } },
  ]);
});

test("gives colliding names the same alias whatever the tool order", () => {
  const tool = (name: string) => ({ ...readArtifact, name });
  const dotted = tool("server.get_issue");
  const plain = tool("server_get_issue");
  for (const order of [
    [dotted, plain],
    [plain, dotted],
  ]) {
    const { adapter } = build([user], order);
    const events = adapter.parseResponse(
      done("await tools.server_get_issue_2({kind: 'a'});"),
    );
    expect(toolCalls(events)).toEqual([
      { callId: "call_1", name: "server_get_issue", args: { kind: "a" } },
    ]);
  }
});

test("declares referenced definitions, nullable types, maps and constraints", () => {
  const writeDeck = {
    name: "write_deck",
    description: "Write the deck.",
    inputSchema: {
      type: "object",
      properties: {
        deck: { $ref: "#/$defs/deck" },
        "content-type": { type: ["string", "null"], maxLength: 40 },
        origin: {
          type: "array",
          prefixItems: [{ $ref: "#/$defs/hex" }, { type: "number" }],
        },
        target: {
          type: "object",
          properties: { id: { type: "string" }, path: { type: "string" } },
          anyOf: [{ required: ["id"] }, { required: ["path"] }],
        },
        style: {
          type: "object",
          properties: { name: { type: "string" } },
          anyOf: [{ $ref: "#/$defs/hex" }],
        },
      },
      required: ["deck"],
      $defs: {
        deck: {
          type: "object",
          properties: {
            slides: {
              type: "array",
              items: { type: "string", maxLength: 80 },
              maxItems: 5,
            },
          },
          additionalProperties: { type: "number" },
        },
        hex: { type: "string", pattern: "^#[0-9a-f]{6}$" },
      },
    },
  };
  const { body } = build([user], [writeDeck]);
  const { description } = body.tools[0];
  expect(description).toContain(
    "type write_deck_deck = {\n  // maxItems 5 — each item: maxLength 80\n  slides?: Array<string>;\n  [key: string]: number;\n};",
  );
  expect(description).toContain("    deck: write_deck_deck;");
  expect(description).toContain(
    '    // maxLength 40\n    "content-type"?: string | null;',
  );
  expect(description).toContain(
    '// pattern "^#[0-9a-f]{6}$"\ntype write_deck_hex = string;',
  );
  expect(description).toContain("origin?: [write_deck_hex, number];");
  expect(description).toContain(
    "style?: ({\n      name?: string;\n    }) & (write_deck_hex);",
  );
  expect(description).toContain(
    "target?: {\n      id: string;\n      path?: string;\n    } | {\n      id?: string;\n      path: string;\n    };",
  );
});
