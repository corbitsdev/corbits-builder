/**
 * The roles the installed plugins declare, from the plugins' manifests and action definitions this
 * interface bundles: what a run's role is called and what it does, which role each plugin action
 * starts, and what a person reads of each action. The app entry hands the files over once, from
 * screen-files.ts, as it does the screens.
 */
import { type } from "arktype";
import {
  isScreen,
  isWorkflow,
  SpecialistBuilder,
  WorkflowActionBuilder,
  type Role,
  type Says,
} from "@corbits-builder/plugin";
import { wording } from "../../config.ts";

// The coordinator is the hub's own agent, the one role no plugin declares.
const COORDINATOR = "coordinator";

// A specialist's manifest, told apart from a plan's or a skill pack's before it is checked.
const RunsSpecialist = type({ runs: "'specialist'" });

let roles: ReadonlyMap<string, Role> = new Map();

// Each plugin action that starts work, as "plugin action", with the role it starts, the document
// kind it always writes, when its start block names one, and what a person reads of it.
let actions: ReadonlyMap<
  string,
  { role: string; kind: string | undefined; says: Says | undefined }
> = new Map();

/** What a person reads of a screen in the conversation's map, from its definition. */
export type ScreenWords = {
  label: (input: unknown) => string | undefined;
  chose: (output: unknown) => string | undefined;
};
let screens: ReadonlyMap<string, ScreenWords> = new Map();

// A bundled file's plugin folder and, for a file of an action's folder, the action.
const PLUGIN_FILE = /plugins\/([^/]+)\/(?:package\.json|src\/([^/]+)\/[^/]+)$/;

/** The plugin folder a bundled file is in. */
export const pluginFolder = (path: string) => PLUGIN_FILE.exec(path)?.[1];

/** Each bundled file of one kind, by its plugin folder and action, such as "designer pick-fonts". */
export function byAction<File>(files: Readonly<Record<string, File>>) {
  return new Map<string, File>(
    Object.entries(files).flatMap(([path, file]) => {
      const [, folder, action] = PLUGIN_FILE.exec(path) ?? [];
      return folder !== undefined && action !== undefined
        ? [[`${folder} ${action}`, file] as const]
        : [];
    }),
  );
}

// A document named by its kind as the interface words it.
const documentWords = (kind: string) =>
  (wording.documentTab[kind] ?? kind.replaceAll("_", " ")).toLowerCase();

/**
 * Makes the roles in the given manifests known, with the actions that start them and what a person
 * reads of each action, from its definition.
 */
export function installRoles({
  manifests,
  definitions,
}: {
  manifests: Readonly<Record<string, { builder?: unknown }>>;
  definitions: Readonly<Record<string, unknown>>;
}) {
  const definitionOf = byAction(definitions);
  const specialists = Object.entries(manifests).flatMap(
    ([path, { builder }]) =>
      RunsSpecialist.allows(builder)
        ? [
            {
              folder: pluginFolder(path),
              builder: SpecialistBuilder.assert(builder),
            },
          ]
        : [],
  );
  roles = new Map(
    specialists.flatMap(({ builder }) =>
      (builder.roles ?? []).map((role) => [role.name, role] as const),
    ),
  );
  actions = new Map(
    specialists.flatMap(({ folder, builder }) =>
      Object.entries(builder.actions).flatMap(([action, entry]) => {
        // Only an action that starts work has a start block.
        if (!("start" in entry)) return [];
        const declared = WorkflowActionBuilder.assert(entry);
        const { start } = declared;
        const role = startedRole(builder, start);
        const kind =
          "kind" in start && typeof start.kind === "string"
            ? start.kind
            : undefined;
        const definition = definitionOf.get(`${folder} ${action}`);
        const says = isWorkflow(definition)
          ? definition.describe.says
          : undefined;
        return [[`${builder.handle} ${action}`, { role, kind, says }] as const];
      }),
    ),
  );
  screens = new Map(
    specialists.flatMap(({ folder, builder }) =>
      Object.keys(builder.actions).flatMap((action) => {
        const screen = definitionOf.get(`${folder} ${action}`);
        if (!isScreen(screen) || screen.describe.says === undefined) return [];
        const { label, chose } = screen.describe.says;
        const words: ScreenWords = {
          label: (raw) => {
            const input = screen.input(raw);
            return input instanceof type.errors
              ? undefined
              : label(input, documentWords);
          },
          chose: (raw) => {
            const output = screen.output(raw);
            return output instanceof type.errors || chose === undefined
              ? undefined
              : chose(output);
          },
        };
        return [[`${builder.handle} ${action}`, words] as const];
      }),
    ),
  );
}

// The role an action's start block starts: its plugin's agent's or package's, each its plugin's own
// unless it names another; a starter of neither starts the plugin's own role.
function startedRole(
  builder: SpecialistBuilder,
  start: WorkflowActionBuilder["start"],
) {
  const named =
    "workflow" in start
      ? builder.packages?.[start.workflow]?.role
      : builder.agents?.[start.agent]?.role;
  return named ?? builder.handle;
}

/** The role an installed plugin declares by this name. */
export const roleOf = (name: string) => roles.get(name);

/** What a person calls the role a run plays: the coordinator, or the label its plugin gives it. */
export function roleLabel(name: string): string {
  if (name === COORDINATOR) return wording.speaker.coordinator;
  return roles.get(name)?.label ?? name;
}

/**
 * The role a plugin action, as "plugin action", starts, with the document kind it always writes and
 * what a person reads of it.
 */
export const actionRole = (action: string) => actions.get(action);

/** What a person reads of a plugin's screen, by its handle and action, when it says. */
export const screenWords = (plugin: string, action: string) =>
  screens.get(`${plugin} ${action}`);

/** Every plugin action that starts work, as "plugin action". */
export const startingActions = () => [...actions.keys()];
