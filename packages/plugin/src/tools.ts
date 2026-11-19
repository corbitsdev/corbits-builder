import { type } from "arktype";
import {
  defineTool,
  type AnnotatedToolFactory,
  type BaseEnv,
} from "@intx/agent/authoring";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";

// The most a plugin's tool may require of its run: the folder it works in, which puts the run on a
// POSIX sidecar, and the run's capabilities.
export interface ToolEnv extends BaseEnv {
  toolCwd: string;
  capabilities: RuntimeCapabilities;
}

// The tools a plugin's agent brings beside the hub's, each made with defineTool, given the name of
// the role the agent plays. Apart from index.ts, so an interface that reads manifests never loads
// the agent framework.
export type AgentTools = (host: {
  role: string;
}) => AnnotatedToolFactory<ToolEnv>[];

export const defineTools = (tools: AgentTools) => tools;

/**
 * The handles of the plugin's credentials that an agent's tools resolve, as their factories declare
 * them. It leaves out the run's hub credential, which every run has.
 */
export function toolCredentials(tools: AgentTools, role: string): string[] {
  const handles = tools({ role }).flatMap((factory) =>
    (factory.credentials ?? []).map(({ handle }) => handle),
  );
  return [...new Set(handles)].filter(
    (handle) => handle !== HUB_CREDENTIAL_HANDLE,
  );
}

type Field = string | number | boolean;

/**
 * What a fixed tool answers the agent: ok, or one of the plugin's fixed codes, each with a few
 * typed fields. It never passes on words from the place the tool works with.
 */
export type Outcome<Code extends string = string> =
  | ({ ok: true } & Record<string, Field>)
  | ({ ok: false; code: Code } & Record<string, Field>);

/** A failed outcome with its code and any typed fields. */
export const failed = <Code extends string>(
  code: Code,
  fields: Record<string, Field> = {},
): Outcome<Code> => ({ ok: false, code, ...fields });

// The code every fixed tool answers with when Builder itself failed it.
const UNAVAILABLE = JSON.stringify({ ok: false, code: "builder_unavailable" });

const NoInput = type({ "+": "reject" });

/** One tool of fixedTools: what the model reads of it, and what it does with the deps of the call. */
export type FixedTool<Deps> = {
  description: string;
  run: (deps: Deps) => Promise<Outcome>;
};

/**
 * A plugin's tools that take no input and answer with an Outcome as JSON, marked as an error when
 * not ok. Each tool's run gets the deps the plugin makes for the call. Anything a run throws is
 * answered with builder_unavailable alone, because a failure's message is Builder's or the place's
 * and not for the agent to read. The run's hub credential is always declared beside the plugin's
 * keys, because a fixed tool reaches the hub through it.
 */
export function fixedTools<Deps>(options: {
  // The tool package's id, as Interchange names its consumer.
  id: string;
  // The handles of the plugin's credentials its tools resolve.
  credentials: readonly string[];
  tools: Readonly<Record<string, FixedTool<Deps>>>;
  deps: (env: ToolEnv, role: string, signal: AbortSignal) => Deps;
}): AgentTools {
  const { tools } = options;
  return ({ role }) => [
    defineTool<ToolEnv>({
      id: options.id,
      credentials: [
        ...options.credentials.map((handle) => ({ handle })),
        { handle: HUB_CREDENTIAL_HANDLE },
      ],
      requires: ["capabilities"],
      definitions: Object.keys(tools).map((name) => ({ name })),
      factory: (env) => ({
        definitions: Object.entries(tools).map(([name, { description }]) => ({
          name,
          description,
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        })),
        run: async (call, signal) => {
          const tool = tools[call.name];
          if (
            tool === undefined ||
            NoInput(call.arguments ?? {}) instanceof type.errors
          )
            return {
              callId: call.id,
              content: `invalid_call: ${call.name} takes no input`,
              isError: true,
            };
          let outcome: Outcome;
          try {
            outcome = await tool.run(options.deps(env, role, signal));
          } catch {
            return { callId: call.id, content: UNAVAILABLE, isError: true };
          }
          return {
            callId: call.id,
            content: JSON.stringify(outcome),
            ...(outcome.ok ? {} : { isError: true }),
          };
        },
      }),
    }),
  ];
}
