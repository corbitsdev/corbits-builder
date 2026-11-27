/**
 * A plugin and its actions as the catalog holds them once read and checked: what the coordinator's
 * discover lists, what execute starts, opens or runs, and what the host's wording and checks take.
 */
import type { ScreenRender } from "@corbits-builder/schemas/project";
import type {
  CheckActionBuilder,
  CheckOutcome,
  Fact,
  Json,
  Kept,
  ProjectRead,
  ProjectValues,
  ProjectView,
  ReadyPlanBuilder,
  Refused,
  Removes,
  ScreenActionBuilder,
  ScreenStatus,
  Shown,
  SkillsBuilder,
  SpecialistBuilder,
  Starter,
  Task,
  TaskActionBuilder,
  WorkflowActionBuilder,
} from "@corbits-builder/plugin";

type Base = {
  description: string;
  // What the coordinator reads to use it.
  guidance: string;
};
type PluginBase = Base & {
  // Its package's name, which tells it from other plugins with the same handle.
  package: string;
  // How discover names it among the others with its handle: its description, or its package's name.
  label: string;
};
type ActionBase = Base & {
  plugin: string;
  action: string;
  // How the coordinator's messages name it, such as "coder change".
  name: string;
  // When to use it, and when not, as its definition says.
  when: string;
  unless: string | undefined;
};
export type WorkflowAction = ActionBase & {
  kind: "workflow";
  builder: WorkflowActionBuilder;
  // The input validated for the host's starter, or the refusal when it is wrong.
  validate: (input: unknown) => { ok: true; input: unknown } | Refused;
  // What its finished run's report adds about the screens that show the work, or null for none.
  presents: string | null;
  // What it tells the person it removes, for an action a ready-made plan takes down with.
  removes: Removes | undefined;
  // The skill packs its specialist's agent is given when this action starts it.
  packs: readonly SkillPack[];
  // The installed workflow it starts: the one its start block names, or its declared agent's.
  workflow: string;
  // The starter a plugin brings for the workflow its start block names, or the default one for an
  // agent it declares.
  starter: Starter;
  // What its start keeps for a run, checked: the record as its definition's record schema takes
  // it, with every value one the action writes; or what is wrong, in a line.
  keep: (kept: Kept) => KeptCheck;
};
export type KeptCheck =
  | { ok: true; record: unknown }
  | { ok: false; problem: string };
export type ScreenAction = ActionBase & {
  kind: "screen";
  builder: ScreenActionBuilder;
  render: ScreenRender;
  state?: (project: ProjectRead) => unknown;
  changesAt?: (project: ProjectRead) => number | undefined;
  status?: (state: unknown) => ScreenStatus | undefined;
  // What the view of a question with this input draws, prepared in the hub.
  fromProject?: (input: unknown, project: ProjectRead) => unknown;
  // Why this input cannot be shown, or undefined when it can.
  refusal: (input: unknown, project: ProjectValues) => string | undefined;
  // The person's answer checked against the screen's output, with the project values it saves, the
  // preferences it sets, what it approves and the plan steps it cancels, or the refusal when it does
  // not fit.
  answer: (output: unknown) =>
    | {
        ok: true;
        // null clears a value; the value's declared type decides whether anything else fits.
        values: Record<string, Json>;
        preferences: Record<string, string>;
        approves: readonly Shown[];
        cancels: readonly string[];
      }
    | Refused;
  // The facts an answer to this input may make true.
  returns: (input: unknown) => Fact[];
};
// A check the host runs against the project as saved, recording whether it holds.
export type CheckAction = ActionBase & {
  kind: "check";
  builder: CheckActionBuilder;
  // The input validated for the check, or the refusal when it is wrong.
  validate: (input: unknown) => { ok: true; input: unknown } | Refused;
  // Decides, from a read-only view of the project as saved and the checked input.
  run: (view: ProjectView, input: unknown) => Promise<CheckOutcome>;
  // How long one run may take: longer for a command check, which runs the app's own commands.
  ms: number;
  // The facts a pass for this input makes true.
  returns: (input: unknown) => Fact[];
};
export type Action = WorkflowAction | ScreenAction | CheckAction;

// Neither the coordinator nor a plan starts a task, so it is kept apart from the actions they can.
export type TaskAction = {
  kind: "task";
  plugin: string;
  action: string;
  name: string;
  builder: TaskActionBuilder;
  definition: Task<unknown>;
  validate: (input: unknown) => { ok: true; input: unknown } | Refused;
};

// Never opened as a question, so the coordinator never sees it.
export type ShownAction = ScreenAction & {
  state: NonNullable<ScreenAction["state"]>;
};

export type SpecialistPlugin = PluginBase & {
  builder: SpecialistBuilder;
  actions: readonly Action[];
  tasks: readonly TaskAction[];
  shown: readonly ShownAction[];
};
export type ReadyPlanPlugin = PluginBase & { builder: ReadyPlanBuilder };
// A skill pack as the host lays it into a specialist's workspace and lists it in the assignment.
export type SkillPack = {
  builder: SkillsBuilder;
  // The specialist its chain of extends reaches.
  specialist: string;
  // The workflow actions it serves, by name, such as "coder change".
  serves: readonly string[];
  // Its folder among the packs: its handle under the folder of the pack it narrows.
  path: string;
  // How many packs it narrows: 0 for one that extends the specialist itself.
  depth: number;
  // Every file in its skills folder, by path there.
  files: Readonly<Record<string, string>>;
};
export type Plugin = SpecialistPlugin | ReadyPlanPlugin;

// A handle several installed plugins share: the one a project uses and the others. missing is the
// package the project's selection names when none of them is that package, so it uses the default.
export type Choice = {
  handle: string;
  using: Plugin;
  others: readonly Plugin[];
  missing?: string;
};
