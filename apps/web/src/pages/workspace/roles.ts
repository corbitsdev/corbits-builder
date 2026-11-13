/**
 * The roles the installed plugins declare, from the plugins' manifests this interface bundles: what
 * a run's role is called and what it does, and which role each plugin action starts. The app entry
 * hands the manifests over once, from screen-files.ts, as it does the screens.
 */
import { type } from "arktype";
import {
  SpecialistBuilder,
  WorkflowActionBuilder,
  type Role,
} from "@corbits-builder/plugin";
import { wording } from "../../config.ts";

// The coordinator is the hub's own agent, the one role no plugin declares.
const COORDINATOR = "coordinator";

// A specialist's manifest, told apart from a plan's or a skill pack's before it is checked.
const RunsSpecialist = type({ runs: "'specialist'" });

let roles: ReadonlyMap<string, Role> = new Map();

// Each plugin action that starts work, as "plugin action", with the role it starts and the document
// kind it always writes, when its start block names one.
let actions: ReadonlyMap<string, { role: string; kind?: string }> = new Map();

/** Makes the roles and the actions that start them in the given manifests known. */
export function installRoles(
  manifests: Readonly<Record<string, { builder?: unknown }>>,
) {
  const specialists = Object.values(manifests).flatMap(({ builder }) =>
    RunsSpecialist.allows(builder) ? [SpecialistBuilder.assert(builder)] : [],
  );
  roles = new Map(
    specialists.flatMap((builder) =>
      (builder.roles ?? []).map((role) => [role.name, role] as const),
    ),
  );
  actions = new Map(
    specialists.flatMap((builder) =>
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
        return [
          [
            `${builder.handle} ${action}`,
            kind === undefined ? { role } : { role, kind },
          ] as const,
        ];
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

/** The role a plugin action, as "plugin action", starts, with the document kind it always writes. */
export const actionRole = (action: string) => actions.get(action);

/** Every plugin action that starts work, as "plugin action". */
export const startingActions = () => [...actions.keys()];
