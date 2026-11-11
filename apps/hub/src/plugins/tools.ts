import { type } from "arktype";
import { defineTool } from "@intx/agent/authoring";
import {
  DISCOVER_DESCRIPTION,
  DISCOVER_NEEDS_ONE,
  foundPlugins,
  noPluginFound,
  pluginHint,
} from "../config/screen-plugins.ts";
import type { PluginHint } from "../environment.ts";
import { PLUGINS, type Plugin } from "./catalog.ts";
import { fields } from "./search/fields.ts";
import { triggers } from "./search/triggers.ts";
import type { Strategy } from "./search/words.ts";

// The one place the search is chosen.
const search: Strategy = fields;

const MAX_FOUND = 5;

// One object rather than a union: providers want a tool's input schema to be a plain object.
const Discover = type({
  "+": "reject",
  "query?": "string > 0",
  "group?": "string > 0",
});

const GROUPS = new Map<string, Plugin[]>();
for (const plugin of PLUGINS)
  for (const group of plugin.builder.groups) {
    const members = GROUPS.get(group) ?? [];
    members.push(plugin);
    GROUPS.set(group, members);
  }

const installed = ({ handle }: { handle: string }) =>
  PLUGINS.filter((plugin) => plugin.builder.handle === handle);

// What discover answers. Its tool asks for exactly one of query and group.
export function discover(asked: typeof Discover.infer) {
  const { query, group } = asked;
  let found: readonly Plugin[] = [];
  if (query !== undefined)
    found = search(query, PLUGINS).slice(0, MAX_FOUND).flatMap(installed);
  if (group !== undefined) found = GROUPS.get(group) ?? [];
  if (found.length === 0) return noPluginFound(asked, GROUPS);
  return foundPlugins(found);
}

// The least score a plugin needs to be hinted. One trigger word is all triggers can score. For fields,
// a word found in the handle, when, examples and summary ("font") scores 10, while common words
// alone ("I want to confront this problem") reach 9.
const TRIGGERS_HINT_LEAST = 1;
const FIELDS_HINT_LEAST = 10;
const HINT_SEARCHES = {
  triggers: { search: triggers, least: TRIGGERS_HINT_LEAST },
  fields: { search: fields, least: FIELDS_HINT_LEAST },
};
const MAX_HINTED = 3;

// The person's message with a note naming plugins its words suggest, or unchanged when none does.
export function withPluginHint(hint: PluginHint, message: string): string {
  if (hint === "off") return message;
  const { search: hintSearch, least } = HINT_SEARCHES[hint];
  const hinted = hintSearch(message, PLUGINS)
    .filter(({ score }) => score >= least)
    .slice(0, MAX_HINTED)
    .flatMap(installed);
  return hinted.length === 0 ? message : message + pluginHint(hinted);
}

// The coordinator finds what it can do from the person's wording instead of carrying every plugin in its prompt.
export function createPluginTools() {
  const definitions = [
    {
      name: "discover",
      description: DISCOVER_DESCRIPTION,
      inputSchema: { ...Discover.toJsonSchema() },
    },
  ];
  return defineTool({
    id: "@corbits-builder/plugins/tools",
    definitions: definitions.map(({ name }) => ({ name })),
    factory: () => ({
      definitions,
      run: async (call) => {
        const input = Discover(call.arguments);
        if (input instanceof type.errors)
          return { callId: call.id, content: input.summary, isError: true };
        if ((input.query === undefined) === (input.group === undefined))
          return {
            callId: call.id,
            content: DISCOVER_NEEDS_ONE,
            isError: true,
          };
        return { callId: call.id, content: discover(input) };
      },
    }),
  });
}
