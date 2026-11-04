import {
  decodeToolName,
  ProtocolMismatchError,
  type AdapterFactory,
} from "@intx/inference";
import type { ConversationTurn } from "@intx/types/runtime";

// Codex models are trained to reach tools through one `exec` tool that runs JavaScript, and given
// plain function tools they repeat calls and write placeholder arguments. The model sees `exec`;
// the one `tools.<name>(...)` call in its script returns to Interchange as an ordinary tool call, so
// the reactor still gates, audits and loop-checks it. Nothing the model writes is executed.

const EXEC = "exec";

// The grammar Codex sends with its `exec` tool.
const EXEC_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

const UNSUPPORTED_SCRIPT =
  "This script was not run. A script makes exactly one tool call, `const result = await tools.<name>({...});`, optionally followed by `text(result)`. The argument is a literal object of strings (backtick strings without `${...}` interpolation), numbers, booleans, null, arrays and objects. Conditions, loops, try/catch and variables are not run. To make several independent calls, send several exec calls at once.";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Schema keywords TypeScript cannot express, shown to the model as comments.
const CONSTRAINTS = [
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "default",
];

type ToolCall = { name: string; arguments: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

const identifier = (name: string) => {
  const safe = name.replace(/[^\w$]/g, "_");
  return /^\d/.test(safe) ? `_${safe}` : safe;
};

// Definitions a schema's `$ref`s point at, rendered as type aliases named `<prefix>_<definition>`.
type Definitions = { prefix: string; names: ReadonlySet<string> };

// Every definition in the schema, including those of a schema embedded whole as a property.
function definitions(
  schema: unknown,
  found = new Map<string, unknown>(),
): Map<string, unknown> {
  if (Array.isArray(schema))
    for (const member of schema) definitions(member, found);
  if (!isRecord(schema)) return found;
  for (const [key, value] of Object.entries(schema)) {
    if ((key === "$defs" || key === "definitions") && isRecord(value))
      for (const [name, def] of Object.entries(value)) found.set(name, def);
    definitions(value, found);
  }
  return found;
}

// The description and constraints of a schema, and of the items of an array schema.
function note(schema: unknown): string {
  if (!isRecord(schema)) return "";
  const limits = CONSTRAINTS.filter((key) => key in schema).map(
    (key) => `${key} ${JSON.stringify(schema[key])}`,
  );
  const description =
    typeof schema["description"] === "string"
      ? schema["description"].replace(/\s*\n\s*/g, " ")
      : "";
  const items = note(schema["items"]);
  return [description, limits.join(", "), items && `each item: ${items}`]
    .filter(Boolean)
    .join(" — ");
}

const without = (schema: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(
    Object.entries(schema).filter(([key]) => !keys.includes(key)),
  );

// A union member read together with the object schema around it, whose properties and required
// fields it extends.
function merged(base: Record<string, unknown>, member: unknown): unknown {
  if (!isRecord(member) || !isRecord(base["properties"])) return member;
  if ("$ref" in member) return { allOf: [base, member] };
  return {
    ...base,
    ...member,
    properties: {
      ...base["properties"],
      ...(isRecord(member["properties"]) ? member["properties"] : undefined),
    },
    required: [base["required"], member["required"]]
      .filter(Array.isArray)
      .flat(),
  };
}

function typeScript(
  schema: unknown,
  indent: string,
  defs: Definitions,
): string {
  if (!isRecord(schema)) return "unknown";
  const ref = schema["$ref"];
  if (typeof ref === "string") {
    const name = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref)?.[1];
    return name !== undefined && defs.names.has(name)
      ? `${defs.prefix}_${identifier(name)}`
      : "unknown";
  }
  if ("const" in schema) return JSON.stringify(schema["const"]);
  const { enum: values, anyOf, oneOf, allOf, items, properties } = schema;
  if (Array.isArray(values))
    return values.map((value) => JSON.stringify(value)).join(" | ");
  const union = Array.isArray(anyOf) ? anyOf : oneOf;
  if (Array.isArray(union)) {
    const base = without(schema, ["anyOf", "oneOf"]);
    return union
      .map((member) => typeScript(merged(base, member), indent, defs))
      .join(" | ");
  }
  if (Array.isArray(allOf)) {
    const base = without(schema, ["allOf"]);
    const parts = isRecord(properties) ? [base, ...allOf] : allOf;
    return parts
      .map((member) => `(${typeScript(member, indent, defs)})`)
      .join(" & ");
  }
  const kinds = Array.isArray(schema["type"])
    ? schema["type"]
    : [schema["type"]];
  if (kinds.length > 1)
    return kinds
      .map((kind) => typeScript({ ...schema, type: kind }, indent, defs))
      .join(" | ");
  const [kind] = kinds;
  const tuple = schema["prefixItems"];
  if (kind === "array" && Array.isArray(tuple))
    return `[${tuple.map((member) => typeScript(member, indent, defs)).join(", ")}]`;
  if (kind === "array") return `Array<${typeScript(items, indent, defs)}>`;
  if (kind === "integer" || kind === "number") return "number";
  if (kind === "string" || kind === "boolean" || kind === "null") return kind;
  const rest = schema["additionalProperties"];
  if (kind !== "object" && !isRecord(properties)) return "unknown";
  if (!isRecord(properties))
    return `Record<string, ${isRecord(rest) ? typeScript(rest, indent, defs) : "unknown"}>`;
  const required = new Set(
    Array.isArray(schema["required"]) ? schema["required"] : [],
  );
  const inner = `${indent}  `;
  const fields = Object.entries(properties).map(([key, value]) => {
    const comment = note(value);
    const name = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    const optional = required.has(key) ? "" : "?";
    return `${comment ? `${inner}// ${comment}\n` : ""}${inner}${name}${optional}: ${typeScript(value, inner, defs)};`;
  });
  if (isRecord(rest))
    fields.push(`${inner}[key: string]: ${typeScript(rest, inner, defs)};`);
  return `{\n${fields.join("\n")}\n${indent}}`;
}

// `alias` is the name the model calls; `wire` is the name the inner adapter knows the tool by.
type FunctionTool = {
  alias: string;
  wire: string;
  description: string;
  parameters: unknown;
};

function execTool(tools: FunctionTool[]) {
  const aliases: string[] = [];
  const methods: string[] = [];
  for (const { alias, description, parameters } of tools) {
    const defs = definitions(parameters);
    const scope = { prefix: alias, names: new Set(defs.keys()) };
    for (const [name, schema] of defs) {
      const comment = note(schema);
      aliases.push(
        `${comment ? `// ${comment}\n` : ""}type ${alias}_${identifier(name)} = ${typeScript(schema, "", scope)};`,
      );
    }
    const doc = description
      .split("\n")
      .map((line) => `  // ${line}`)
      .join("\n");
    methods.push(
      `${doc}\n  ${alias}(args: ${typeScript(parameters, "  ", scope)}): Promise<unknown>;`,
    );
  }
  return {
    type: "custom",
    name: EXEC,
    description: [
      "Run a script that calls one tool.",
      "- Write `const result = await tools.<name>({...});` then `text(result)`.",
      "- A script makes exactly one tool call, with a literal object argument; conditions, loops, try/catch and variables are not run.",
      "- To make several independent calls, send several exec calls at once.",
      "",
      "```ts",
      ...aliases,
      `declare const tools: {\n${methods.join("\n\n")}\n};`,
      "```",
    ].join("\n"),
    format: { type: "grammar", syntax: "lark", definition: EXEC_GRAMMAR },
  };
}

function functionTools(tools: unknown): FunctionTool[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const found: Omit<FunctionTool, "alias">[] = [];
  for (const tool of tools) {
    if (
      !isRecord(tool) ||
      tool["type"] !== "function" ||
      typeof tool["name"] !== "string" ||
      tool["name"] === EXEC ||
      typeof tool["description"] !== "string"
    )
      return undefined;
    found.push({
      wire: tool["name"],
      description: tool["description"],
      parameters: tool["parameters"],
    });
  }
  // Aliases are given in name order, so a tool keeps its alias however the list is ordered.
  const taken = new Set([EXEC]);
  const aliases = new Map<string, string>();
  for (const wire of found.map((tool) => tool.wire).sort()) {
    const base = identifier(decodeToolName(wire));
    let alias = base;
    for (let n = 2; taken.has(alias); n++) alias = `${base}_${n}`;
    taken.add(alias);
    aliases.set(wire, alias);
  }
  return found.map((tool) => ({
    ...tool,
    alias: aliases.get(tool.wire) ?? tool.wire,
  }));
}

const callScript = (alias: string, args: string) =>
  `const result = await tools.${alias}(${args});\ntext(result);\n`;

// The wire body carries tool results as plain text, so which calls failed is read from the turns.
const failedCalls = (messages: ConversationTurn[]) =>
  new Set(
    messages.flatMap(({ content }) =>
      content.flatMap((block) =>
        block.type === "tool_result" && block.isError ? [block.callId] : [],
      ),
    ),
  );

// Past calls are shown to the model as the script it would have written for each one.
function historyItems(
  input: unknown[],
  aliases: ReadonlyMap<string, string>,
  failed: ReadonlySet<string>,
): unknown[] {
  const unsupported = new Set<string>();
  return input.map((item) => {
    if (!isRecord(item) || typeof item["call_id"] !== "string") return item;
    const callId = item["call_id"];
    if (
      item["type"] === "function_call" &&
      typeof item["name"] === "string" &&
      typeof item["arguments"] === "string"
    ) {
      const args = parseJSON(item["arguments"]);
      if (
        item["name"] === EXEC &&
        isRecord(args) &&
        typeof args["script"] === "string"
      ) {
        unsupported.add(callId);
        return {
          type: "custom_tool_call",
          call_id: callId,
          name: EXEC,
          input: args["script"],
        };
      }
      return {
        type: "custom_tool_call",
        call_id: callId,
        name: EXEC,
        input: callScript(
          aliases.get(item["name"]) ?? identifier(decodeToolName(item["name"])),
          item["arguments"],
        ),
      };
    }
    if (item["type"] === "function_call_output") {
      const result =
        typeof item["output"] === "string"
          ? item["output"]
          : JSON.stringify(item["output"]);
      let output = `Script completed\nOutput:\n${result}`;
      if (failed.has(callId)) output = `Script failed\nError:\n${result}`;
      if (unsupported.has(callId)) output = UNSUPPORTED_SCRIPT;
      return { type: "custom_tool_call_output", call_id: callId, output };
    }
    return item;
  });
}

// Index just past the string, template or comment opening at `start`, or `start` when none does.
function skipLiteral(source: string, start: number): number {
  const char = source.charAt(start);
  if (char === '"' || char === "'" || char === "`") {
    let i = start + 1;
    while (i < source.length && source.charAt(i) !== char)
      i += source.charAt(i) === "\\" ? 2 : 1;
    return i + 1;
  }
  if (source.startsWith("//", start)) {
    const end = source.indexOf("\n", start);
    return end === -1 ? source.length : end + 1;
  }
  if (source.startsWith("/*", start)) {
    const end = source.indexOf("*/", start + 2);
    return end === -1 ? source.length : end + 2;
  }
  return start;
}

// The top-level statements of a script, split at `;` and line breaks outside brackets, strings
// and comments. A regular expression literal can be misread as a string; the statement it lands
// in then matches no accepted shape, so the script is refused rather than misread.
function statements(source: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  // Index of the last character outside whitespace and comments, which decides whether a line
  // break ends the statement.
  let last = -1;
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);
    const comment = source.startsWith("//", i) || source.startsWith("/*", i);
    if (comment && depth === 0) found.push(source.slice(start, i));
    const after = skipLiteral(source, i);
    if (after !== i) {
      i = after;
      if (comment && depth === 0) start = i;
      if (!comment) last = i - 1;
      continue;
    }
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    const continues =
      char === "\n" &&
      /(?:=|\bawait)$/.test(source.slice(Math.max(start, last - 6), last + 1));
    if (!/\s/.test(char)) last = i;
    if (depth === 0 && (char === ";" || (char === "\n" && !continues))) {
      found.push(source.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  found.push(source.slice(start));
  return found.map((statement) => statement.trim()).filter(Boolean);
}

// Index of the parenthesis closing the one before `open`, or -1.
function closingParen(source: string, open: number): number {
  let depth = 1;
  let i = open;
  while (i < source.length) {
    const after = skipLiteral(source, i);
    if (after !== i) {
      i = after;
      continue;
    }
    if (source.charAt(i) === "(") depth++;
    if (source.charAt(i) === ")" && --depth === 0) return i;
    i++;
  }
  return -1;
}

const CODE_POINT = /u\{([0-9a-fA-F]+)\}/y;
// A `\u{...}` escape in a quoted string, after an even run of backslashes.
const QUOTED_CODE_POINT = /(?<!\\)((?:\\\\)*)\\u\{([0-9a-fA-F]+)\}/g;

// A code point as JSON5 string text, safe inside either quote.
const codePoint = (point: number) =>
  JSON.stringify(String.fromCodePoint(point)).slice(1, -1).replace("'", "\\'");

// `text` with each `\u{...}` escape, which JSON5 lacks, written out, or `undefined` when one is
// out of range.
function withCodePoints(text: string): string | undefined {
  let valid = true;
  const out = text.replace(
    QUOTED_CODE_POINT,
    (_match, slashes: string, hex: string) => {
      const point = Number.parseInt(hex, 16);
      valid &&= point <= 0x10ffff;
      return valid ? slashes + codePoint(point) : "";
    },
  );
  return valid ? out : undefined;
}

// `literal` as JSON5: each template literal becomes a JSON string and each `\u{...}` escape a
// character, or `undefined` when a template interpolates, since its value depends on code that is
// not run, or an escape is out of range.
function asJSON5(literal: string): string | undefined {
  let out = "";
  let i = 0;
  while (i < literal.length) {
    const after = skipLiteral(literal, i);
    if (after === i) {
      out += literal.charAt(i++);
      continue;
    }
    const text = literal.slice(i, after);
    i = after;
    if (!text.startsWith("`")) {
      const quoted = withCodePoints(text);
      if (quoted === undefined) return undefined;
      out += quoted;
      continue;
    }
    const body = text.slice(1, -1);
    let string = '"';
    for (let k = 0; k < body.length; k++) {
      const char = body.charAt(k);
      if (char === "$" && body.charAt(k + 1) === "{") return undefined;
      if (char === "\\") {
        CODE_POINT.lastIndex = k + 1;
        const hex = CODE_POINT.exec(body)?.[1];
        if (hex === undefined) {
          const next = body.charAt(++k);
          if (next === "\r") {
            if (body.charAt(k + 1) === "\n") k++;
            continue;
          }
          string += next === "`" || next === "$" ? next : char + next;
          continue;
        }
        const point = Number.parseInt(hex, 16);
        if (point > 0x10ffff) return undefined;
        string += codePoint(point);
        k = CODE_POINT.lastIndex - 1;
      } else if (char === '"') string += '\\"';
      else if (char === "\n") string += "\\n";
      else if (char === "\r") {
        string += "\\n";
        if (body.charAt(k + 1) === "\n") k++;
      } else string += char;
    }
    out += `${string}"`;
  }
  return out;
}

const CALL_STATEMENT =
  /^(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*)?await\s+tools\.([A-Za-z_$][\w$]*)\s*\(/;
// Output adds nothing to the call, so only output of a variable, a property of one or a plain
// string is accepted; anything that evaluates more could hide a second call.
const PATH = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[\d+\])*`;
const STRING = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\`[^\`$\\]*\``;
const OUTPUT_STATEMENT = new RegExp(
  String.raw`^(?:text|console\.log)\(\s*(?:${PATH}|${STRING}|JSON\.stringify\(\s*${PATH}(?:\s*,\s*null\s*,\s*\d+)?\s*\))\s*\)$`,
);

/**
 * The one tool call a model's script makes, named as `tools` maps the alias it calls, or `undefined`
 * when the script is anything else: more than one call, a call to an unknown tool, an argument that
 * is not a literal object, or any statement besides the call and `text(<variable>)` output, such as
 * a condition, loop or try/catch. The script is read, never run; the argument is parsed as JSON5,
 * the data subset of JavaScript.
 */
export function scriptCall(
  source: string,
  tools: ReadonlyMap<string, string>,
): ToolCall | undefined {
  let call: ToolCall | undefined;
  for (const statement of statements(source)) {
    if (OUTPUT_STATEMENT.test(statement)) continue;
    const match = CALL_STATEMENT.exec(statement);
    const alias = match?.[1];
    const name = alias === undefined ? undefined : tools.get(alias);
    if (match === null || name === undefined || call) return undefined;
    const open = match[0].length;
    if (closingParen(statement, open) !== statement.length - 1)
      return undefined;
    const literal = asJSON5(statement.slice(open, -1).trim());
    if (literal === undefined) return undefined;
    let args: unknown = {};
    if (literal !== "") {
      try {
        args = Bun.JSON5.parse(literal);
      } catch (error) {
        if (error instanceof SyntaxError) return undefined;
        throw error;
      }
    }
    if (!isRecord(args)) return undefined;
    call = { name, arguments: args };
  }
  return call;
}

type CustomToolCall = { id: string; call_id: string; input: string };

function customToolCall(item: unknown): CustomToolCall | undefined {
  if (
    !isRecord(item) ||
    item["type"] !== "custom_tool_call" ||
    typeof item["id"] !== "string" ||
    typeof item["call_id"] !== "string" ||
    typeof item["input"] !== "string"
  )
    return undefined;
  return { id: item["id"], call_id: item["call_id"], input: item["input"] };
}

// A script that cannot be read becomes an `exec` call, which no tool answers, and is replayed to
// the model as UNSUPPORTED_SCRIPT.
function functionCall(
  call: CustomToolCall,
  tools: ReadonlyMap<string, string>,
) {
  const { name, arguments: args } = scriptCall(call.input, tools) ?? {
    name: EXEC,
    arguments: { script: call.input },
  };
  return {
    type: "function_call",
    id: call.id,
    call_id: call.call_id,
    name,
    arguments: JSON.stringify(args),
  };
}

/**
 * Wraps a Responses adapter so the model reaches its tools through one `exec` code tool, the way
 * Codex serves its models. Each tool is offered under a JavaScript-safe alias of its decoded name.
 * Requests with a tool that is not a function tool pass through unchanged.
 */
export function withCodeMode(factory: AdapterFactory): AdapterFactory {
  return (source, quirks) => {
    const adapter = factory(source, quirks);
    let wires: ReadonlyMap<string, string> = new Map();
    return {
      ...adapter,
      buildRequest: (messages, model, options) => {
        const request = adapter.buildRequest(messages, model, options);
        const body = parseJSON(request.body);
        if (!isRecord(body) || !Array.isArray(body["input"])) return request;
        const tools = functionTools(body["tools"]);
        wires = new Map(tools?.map(({ alias, wire }) => [alias, wire]));
        if (tools === undefined) return request;
        const aliases = new Map(tools.map(({ alias, wire }) => [wire, alias]));
        return {
          ...request,
          body: JSON.stringify({
            ...body,
            tools: [execTool(tools)],
            input: historyItems(body["input"], aliases, failedCalls(messages)),
          }),
        };
      },
      parseResponse: (sseData) => {
        const event = parseJSON(sseData);
        if (
          !isRecord(event) ||
          !isRecord(event["item"]) ||
          event["item"]["type"] !== "custom_tool_call"
        )
          return adapter.parseResponse(sseData);
        if (event["type"] !== "response.output_item.done") return [];
        const call = customToolCall(event["item"]);
        if (call === undefined)
          throw new ProtocolMismatchError(
            "output_item.done custom_tool_call is missing id, call_id or input",
            event,
          );
        const { sequence_number, output_index } = event;
        const { arguments: args, ...item } = functionCall(call, wires);
        return [
          ...adapter.parseResponse(
            JSON.stringify({
              type: "response.output_item.added",
              sequence_number,
              output_index,
              item: { ...item, arguments: "" },
            }),
          ),
          ...adapter.parseResponse(
            JSON.stringify({
              type: "response.function_call_arguments.delta",
              sequence_number,
              output_index,
              item_id: item.id,
              delta: args,
            }),
          ),
        ];
      },
      parseJSONResponse: (responseBody) => {
        const body = parseJSON(responseBody);
        if (!isRecord(body) || !Array.isArray(body["output"]))
          return adapter.parseJSONResponse(responseBody);
        const output = body["output"].map((item: unknown) => {
          if (!isRecord(item) || item["type"] !== "custom_tool_call")
            return item;
          const call = customToolCall(item);
          if (call === undefined)
            throw new ProtocolMismatchError(
              "custom_tool_call output item is missing id, call_id or input",
              item,
            );
          return functionCall(call, wires);
        });
        return adapter.parseJSONResponse(JSON.stringify({ ...body, output }));
      },
    };
  };
}
