import type { Plugin } from "../plugins/catalog.ts";

// What the coordinator reads when its question names a screen plugin the hub does not have.
export function unknownScreenPlugin(
  handle: string,
  installed: readonly Plugin[],
): string {
  return [
    `${JSON.stringify(handle)} is not an installed screen plugin, so nothing was shown.`,
    "",
    "Installed screen plugins:",
    ...installed.map(
      (plugin) => `  ${plugin.builder.handle}: ${plugin.description}`,
    ),
    "",
    "Call again with plugin set to one of them, or ask a plain question with questions instead.",
  ].join("\n");
}

export const DISCOVER_DESCRIPTION =
  "Find a plugin for something the person wants that none of your other tools obviously does. Pass query with what they asked for, in their words, or group to list every plugin in that group. A screen plugin is then shown to the person with question({ plugin, input }).";

export const DISCOVER_NEEDS_ONE =
  "Pass either query, with what the person asked for, or group.";

export const foundPlugins = (found: readonly Plugin[]) =>
  found
    .map(({ builder, guidance }) =>
      [
        `${builder.handle} runs a ${builder.runs}. Groups: ${builder.groups.join(", ")}.`,
        guidance,
      ].join("\n"),
    )
    .join("\n\n");

export function noPluginFound(
  asked: { query?: string; group?: string },
  groups: ReadonlyMap<string, readonly Plugin[]>,
): string {
  const missing =
    asked.group === undefined
      ? `No plugin matches ${JSON.stringify(asked.query)}.`
      : `No plugin is in the group ${JSON.stringify(asked.group)}.`;
  return [
    missing,
    "",
    "Groups:",
    ...[...groups].map(
      ([group, plugins]) =>
        `  ${group}: ${plugins.map(({ builder, description }) => `${builder.handle} (${description})`).join("; ")}`,
    ),
    "",
    "Call again with group set to one of them, or carry on without a plugin.",
  ].join("\n");
}

// Appended after the person's words, so the person's view strips from the lead to the end.
export const PLUGIN_HINT_LEAD =
  "\n\nBuilder's note, not written by the person: Builder noticed plugins that may fit this message.";
export const PLUGIN_HINT_END =
  "If none fits, call discover or carry on without a plugin.";

export const pluginHint = (plugins: readonly Plugin[]) =>
  [
    PLUGIN_HINT_LEAD,
    ...plugins.map(({ builder, description }) =>
      builder.runs === "screen"
        ? `- ${builder.handle}: ${description} Open it with question({ plugin: "${builder.handle}" }); Builder supplies the values it reads.`
        : `- ${builder.handle}: ${description}`,
    ),
    PLUGIN_HINT_END,
  ].join("\n");
