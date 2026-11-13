import { join } from "node:path";
import { type, type Type } from "arktype";
import {
  CheckActionBuilder,
  guidanceText,
  inputText,
  isCheck,
  isScreen,
  isWorkflow,
  ReadyPlanBuilder,
  ScreenActionBuilder,
  SkillsBuilder,
  SpecialistBuilder,
  declaredRole,
  lookOf,
  validateInput,
  validateOutput,
  validateWorkflowInput,
  WorkflowActionBuilder,
  type AgentPackage,
  type AppStarter,
  type Check,
  type CheckOutcome,
  type Fact,
  type ProjectValues,
  type ProjectView,
  type ModelSetting,
  type OutputBudget,
  type Refused,
  type Role,
  type Screen,
  type DesignBuilder,
  type Shown,
  type ValueDeclaration,
  type Workflow,
} from "@corbits-builder/plugin";
import {
  CHECK_MS,
  checkMs,
  factFields,
  proofFields,
  proofText,
  validateCodeInput,
  validateFields,
} from "./checks.ts";
import {
  approvalFacts,
  makes,
  negated,
  patternFact,
  resolveFacts,
  templateField,
} from "./facts.ts";
import type { FiledVersion, Kept, Project, Started } from "./coordinator.ts";
import type { Found } from "./folder.ts";
import {
  presentsText,
  checkText,
  requiresText,
  screenText,
  suppliedText,
} from "./text.ts";

/** What a host supplies the catalog: all it needs that the plugins themselves cannot say. */
export type Host = {
  // Every fact the host works out from what it stores.
  facts: ReadonlySet<Fact>;
  // The ids of the preferences a screen's answer may set for the project, and a role's assignment
  // may carry.
  preferences: ReadonlySet<string>;
  // The model settings and output budgets of the host's own roles, by name; a plugin's role may
  // name them as well as its plugin's.
  settings: ReadonlyMap<string, ModelSetting>;
  budgets: ReadonlyMap<string, OutputBudget>;
};

/** A starter a plugin brings, which starts its run in the project with the action's skill packs. */
export type Starter = {
  // Why a start block is wrong for this starter, or undefined when it takes it.
  check(start: WorkflowActionBuilder["start"]): string | undefined;
  // The input fields it reads, which every action it starts must take.
  reads: readonly string[];
  run(
    start: unknown,
    input: unknown,
    project: Project,
    skills: string,
  ): Promise<Started>;
};

/**
 * A starter of one workflow: start is the start block it takes, input the fields of the action's
 * checked input it reads, and run starts the work in context with the index of the action's skill
 * packs for the assignment.
 */
export function defineStarter<
  Start extends Type,
  Input extends Type<object>,
  Context,
>(
  start: Start,
  input: Input,
  run: (
    start: Start["infer"],
    input: Input["infer"],
    context: Context,
    skills: string,
  ) => Promise<Started>,
) {
  return {
    check(raw: unknown) {
      const checked = start(raw);
      return checked instanceof type.errors ? checked.summary : undefined;
    },
    reads: input.props.map(({ key }) => String(key)),
    run: (raw: unknown, checked: unknown, context: Context, skills: string) =>
      run(start.assert(raw), input.assert(checked), context, skills),
  };
}

type Start = WorkflowActionBuilder["start"];
/** Whether a start block names an agent the plugin declares rather than an installed workflow. */
export const startsAgent = (
  start: Start,
): start is Exclude<Start, { workflow: string }> => !("workflow" in start);

const AgentInput = type({ instruction: "string", "[string]": "unknown" });

// The default starter's first message: the instruction, each other input field on a line of its own,
// the documents filed, the kind to file the result under, and the skill packs.
function agentAssignment(
  { instruction, ...fields }: typeof AgentInput.infer,
  filing: readonly string[],
  versions: ReadonlyMap<string, FiledVersion>,
  skills: string,
) {
  const filed = [...versions].map(
    ([kind, { version }]) => `${kind} (version ${version})`,
  );
  return [
    instruction,
    Object.entries(fields)
      .map(
        ([name, value]) =>
          `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join("\n"),
    filed.length === 0
      ? "Nothing is filed in the project yet."
      : `Filed in the project: ${filed.join(", ")}.`,
    ...filing.map((kind) =>
      versions.has(kind)
        ? `File your result with write_artifact as kind ${kind}. A version of it is already filed: read it first, as yours replaces it.`
        : `File your result with write_artifact as kind ${kind}.`,
    ),
    skills.trim(),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
}

// The starter of an agent a plugin declares: one run, whose first message is built from the action's
// checked input and the project, filing under each kind the action's returns name.
function agentStarter(agent: string, returns: readonly Fact[]): Starter {
  return {
    check: (start) =>
      startsAgent(start) && start.agent === agent
        ? undefined
        : `starts the agent ${agent}`,
    reads: ["instruction"],
    run: async (_start, input, project, skills) => {
      const checked = AgentInput.assert(input);
      const filing = resolveFacts(returns, checked)
        .filter((fact) => fact.startsWith("filed:"))
        .map((fact) => fact.slice("filed:".length));
      return {
        runs: [
          await project.deploy({
            workflow: agent,
            correlation: agent,
            assignment: ({ versions }) =>
              agentAssignment(checked, filing, versions, skills),
          }),
        ],
        notStarted: [],
      };
    },
  };
}

const isStarter = (value: unknown): value is Starter =>
  typeof value === "object" &&
  value !== null &&
  "check" in value &&
  typeof value.check === "function" &&
  "reads" in value &&
  Array.isArray(value.reads) &&
  "run" in value &&
  typeof value.run === "function";

// The builder block of whichever kind the manifest says it runs.
const Manifest = type({
  name: "string > 0",
  version: "string > 0",
  "description?": "string",
  builder: SpecialistBuilder.or(ReadyPlanBuilder),
});
// A skill pack's manifest, told apart from a plugin's by what it runs before either is checked.
const RunsSkills = type({ builder: { runs: "'skills'" } });
const PackManifest = type({ builder: SkillsBuilder });

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
type KeptCheck = { ok: true; record: unknown } | { ok: false; problem: string };
export type ScreenAction = ActionBase & {
  kind: "screen";
  builder: ScreenActionBuilder;
  // Why this input cannot be shown, or undefined when it can.
  refusal: (input: unknown, project: ProjectValues) => string | undefined;
  // The person's answer checked against the screen's output, with the project values it saves, the
  // preferences it sets and what it approves, or the refusal when it does not fit.
  answer: (output: unknown) =>
    | {
        ok: true;
        values: Record<string, string>;
        preferences: Record<string, string>;
        approves: readonly Shown[];
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

export type SpecialistPlugin = PluginBase & {
  builder: SpecialistBuilder;
  actions: readonly Action[];
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

/** A starter a plugin declares, with every file of its folder by path there. */
export type StarterFiles = AppStarter & {
  files: Readonly<Record<string, string>>;
};

/**
 * What a plugin that drafts designs declares, read: the files a design workspace starts from, each
 * theme's sample design by its id, and the looks; and the look whose theme a concept starts from,
 * by the concept's label.
 */
export type Design = {
  starter: Readonly<Record<string, string>>;
  themes: ReadonlyMap<string, Readonly<Record<string, string>>>;
  looks: DesignBuilder["looks"];
  themeOf(label: string): DesignBuilder["looks"][number] | undefined;
};

/** The project value that selects which of the plugins sharing a handle a project uses, by package name. */
export const selectionName = (handle: string) => `plugins.${handle}`;

export type PluginPackage =
  | { role: string; entry: string }
  | { role: string; agent: AgentPackage };

/**
 * The installed plugins as one project sees them: one plugin per handle, the one its selection names
 * of those that share a handle, else their default.
 */
export type Catalog = {
  plugins: readonly Plugin[];
  // The screens an execute call can show.
  screens: readonly ScreenAction[];
  // Every action of every specialist: started, run or opened with execute.
  actions: readonly Action[];
  installed(handle: string): Plugin | undefined;
  // A fact in plain words.
  factText(fact: Fact): string;
  // Every project value by name: each one a plugin declares, and the selection of each handle
  // several plugins share.
  values: ReadonlyMap<string, ValueDeclaration>;
  // Each workflow package a plugin brings, by name, with the name of the role its runs play: its
  // entry's path in the plugins folder, or the agent it declares, which the host builds.
  packages: ReadonlyMap<string, PluginPackage>;
  // Every role the installed plugins declare, whichever of a shared handle a project uses, since a
  // run of any of them may still be live; and one of them by name.
  roles: readonly Role[];
  role(name: string): Role | undefined;
  // Every model setting and output budget a role may name, by name: the host's and each installed
  // plugin's.
  settings: ReadonlyMap<string, ModelSetting>;
  budgets: ReadonlyMap<string, OutputBudget>;
  // The code a first build can start from, by name, with its files, of every installed plugin;
  // and the one a project with code but no recorded starter is taken to have started from.
  appStarters: ReadonlyMap<string, StarterFiles>;
  legacyStarter: { name: string; starter: AppStarter } | undefined;
  // What design workspaces start from and the looks they offer, when a plugin drafts designs.
  design: Design | undefined;
  // Each handle several installed plugins share, with the one this catalog uses.
  choices: readonly Choice[];
  // The catalog as a project with these values sees it; only the selection values are read.
  select(values: Readonly<Record<string, unknown>>): Catalog;
};

export const isSpecialist = (plugin: Plugin): plugin is SpecialistPlugin =>
  plugin.builder.runs === "specialist";
export const isReadyPlan = (plugin: Plugin): plugin is ReadyPlanPlugin =>
  plugin.builder.runs === "plan";
export const isWorkflowAction = (action: Action): action is WorkflowAction =>
  action.kind === "workflow";
export const isScreenAction = (action: Action): action is ScreenAction =>
  action.kind === "screen";
export const isCheckAction = (action: Action): action is CheckAction =>
  action.kind === "check";

const lines = (
  name: string,
  { when, unless }: { when: string; unless: string },
  summary: string,
) => [`${name}: ${summary}`, `Use it when: ${when}`, `Not when: ${unless}`];

// The plugin a folder holds, refused with the folder and field when its manifest is wrong.
function manifestOf(found: Found) {
  const manifest = Manifest(found.manifest);
  if (manifest instanceof type.errors)
    throw new Error(
      `plugins/${found.folder}/package.json: ${manifest.summary}`,
    );
  const { name, builder, description = "" } = manifest;
  return {
    found,
    builder,
    about: {
      package: name,
      label: description === "" ? name : description,
      description,
    },
  };
}

function packOf(found: Found) {
  const manifest = PackManifest(found.manifest);
  if (manifest instanceof type.errors)
    throw new Error(
      `plugins/${found.folder}/package.json: ${manifest.summary}`,
    );
  return { found, builder: manifest.builder };
}

/**
 * The files of an action's folder, by their paths in its plugin: the definition every action has,
 * the view that shows a screen to the person, and data a screen ships.
 */
export const actionFiles = (action: string) => ({
  definition: `./src/${action}/definition.ts`,
  view: `./src/${action}/view.tsx`,
  data: `./src/${action}/data.json`,
});

/**
 * The files a manifest leads to: the modules the catalog imports, the texts it reads, the folders
 * it lays out, and which of its actions' files are there.
 */
export async function manifestFiles(found: Found) {
  if (RunsSkills.allows(found.manifest))
    return {
      modules: [],
      texts: [],
      folders: [packOf(found).builder.skills],
      present: [],
    };
  const { builder } = manifestOf(found);
  if (builder.runs !== "specialist")
    return { modules: [], texts: [builder.guidance], folders: [], present: [] };
  const files = Object.keys(builder.actions).flatMap((action) => {
    const { definition, view, data } = actionFiles(action);
    return [definition, view, data];
  });
  const present = (
    await Promise.all(
      files.map(async (path) => ((await found.has(path)) ? [path] : [])),
    )
  ).flat();
  return {
    // A view is the interface's to bundle, never the hub's.
    modules: [
      ...present.filter((path) => !path.endsWith(".tsx")),
      ...Object.values(builder.starters ?? {}),
    ],
    texts: Object.values(builder.agents ?? {}).map(({ prompt }) => prompt),
    folders: [
      ...Object.values(builder.appStarters ?? {}).map(({ folder }) => folder),
      ...(builder.design?.starter ? [builder.design.starter] : []),
      ...(builder.design?.themes ? [builder.design.themes] : []),
    ],
    present,
  };
}

// An action as its folder and manifest entry declare it: its kind, its entry checked against that
// kind's builder, its definition and, for a screen, the data it ships.
type Declared =
  | {
      kind: "screen";
      builder: ScreenActionBuilder;
      definition: Screen<unknown, unknown, unknown, unknown>;
      data: unknown;
    }
  | {
      kind: "workflow";
      builder: WorkflowActionBuilder;
      definition: Workflow<unknown>;
    }
  | { kind: "check"; builder: CheckActionBuilder; definition: Check<unknown> };

// An action with a view is shown to the person; one with check proofs, or whose definition is a
// check's, is a check; any other starts work.
async function declaredAction(
  found: Found,
  handle: string,
  action: string,
  entry: object,
): Promise<Declared> {
  const name = `${handle} ${action}`;
  const files = actionFiles(action);
  const where = `plugins/${found.folder}/package.json: ${name}`;
  if (!(await found.has(files.definition)))
    throw new Error(`${where} has no ${files.definition}`);
  const definition = await found.module(files.definition);
  const shipsData = await found.has(files.data);
  if (await found.has(files.view)) {
    const builder = ScreenActionBuilder(entry);
    if (builder instanceof type.errors)
      throw new Error(
        `${where} is a screen, as its ${files.view} says: ${builder.summary}`,
      );
    if (!isScreen(definition))
      throw new Error(
        `${name}'s ${files.definition} has no screen as its default export`,
      );
    if (!shipsData)
      return { kind: "screen", builder, definition, data: undefined };
    if (!definition.data)
      throw new Error(
        `${name} ships ${files.data}, but its definition declares no data schema`,
      );
    const data = definition.data.assert(await found.module(files.data));
    return { kind: "screen", builder, definition, data };
  }
  if (shipsData)
    throw new Error(
      `${name} ships ${files.data}, which only a screen, with a view, reads`,
    );
  if ("all" in entry || "any" in entry || isCheck(definition)) {
    const builder = CheckActionBuilder(entry);
    if (builder instanceof type.errors)
      throw new Error(`${where} is a check: ${builder.summary}`);
    if (!isCheck(definition))
      throw new Error(
        `${name}'s ${files.definition} has no check as its default export`,
      );
    return { kind: "check", builder, definition };
  }
  const builder = WorkflowActionBuilder(entry);
  if (builder instanceof type.errors)
    throw new Error(
      `${where} starts work, having no view and no check proofs: ${builder.summary}`,
    );
  if (!isWorkflow(definition))
    throw new Error(
      `${name}'s ${files.definition} has no workflow action as its default export`,
    );
  return { kind: "workflow", builder, definition };
}

// A plugin's manifest, with each of a specialist's actions as its folder declares it.
async function manifested(found: Found) {
  const { builder, about } = manifestOf(found);
  const actions = new Map<string, Declared>();
  if (builder.runs === "specialist")
    for (const [action, entry] of Object.entries(builder.actions))
      actions.set(
        action,
        await declaredAction(found, builder.handle, action, entry),
      );
  return { found, builder, about, actions };
}
type Manifested = Awaited<ReturnType<typeof manifested>>;

// A template the host fills, or one a check returns, such as "live:{address}".
const knownTemplate = (fact: Fact, known: ReadonlySet<Fact>) =>
  fact.startsWith("filed:") ||
  fact.startsWith("approved:") ||
  [...known].some((made) => makes(made, fact));

// Refuses a fact that is neither one the host works out or a check makes, or its negation, nor a
// known template on a field the plugin takes.
function checkFacts(
  name: string,
  facts: readonly Fact[],
  known: ReadonlySet<Fact>,
  takes: (field: string) => boolean,
) {
  const unknown = facts.find((fact) => {
    const field = templateField(fact);
    return field === undefined
      ? !known.has(negated(fact) ?? fact)
      : !takes(field) || !knownTemplate(fact, known);
  });
  if (unknown !== undefined)
    throw new Error(
      `${name} names ${unknown}, which is not a fact Builder knows`,
    );
}

// Each fact a check returns, by the name of the check that makes it true.
function checkMade(manifests: readonly Manifested[]) {
  const made = new Map<Fact, string>();
  for (const { builder, actions } of manifests)
    for (const [action, declared] of actions)
      if (declared.kind === "check")
        for (const fact of declared.builder.returns)
          made.set(fact, `${builder.handle} ${action}`);
  return made;
}

// Each fact in the words of the one plugin that describes it. Every fact the host works out has
// words, except a fact about one kind of document, which reads well enough from the kind; a fact a
// check makes that no plugin describes reads as that check passing.
function factWords(
  manifests: readonly Manifested[],
  host: ReadonlySet<Fact>,
  made: ReadonlyMap<Fact, string>,
) {
  const known = new Set([...host, ...made.keys()]);
  const words = new Map<Fact, { handle: string; text: string }>();
  for (const { builder } of manifests)
    for (const [fact, text] of Object.entries(builder.facts ?? {})) {
      if (!known.has(negated(fact) ?? fact))
        throw new Error(
          `${builder.handle} describes ${fact}, which is not a fact Builder knows`,
        );
      const other = words.get(fact);
      if (other)
        throw new Error(
          `${builder.handle} describes ${fact}, which ${other.handle} describes too`,
        );
      words.set(fact, { handle: builder.handle, text });
    }
  for (const fact of host)
    if (!patternFact(fact) && !words.has(fact))
      throw new Error(`Builder works out ${fact}, but no plugin describes it`);
  return (fact: Fact): string => {
    const described = words.get(fact)?.text;
    if (described !== undefined) return described;
    const field = templateField(fact);
    const pattern = patternFact(fact);
    const maker = [...made].find(
      ([returned]) => returned === fact || makes(returned, fact),
    );
    if (maker !== undefined)
      return field === undefined
        ? `the ${maker[1]} check passed`
        : `the ${maker[1]} check passed for each ${field} given`;
    if (field !== undefined)
      return fact.startsWith("filed:")
        ? `each document named in ${field} is filed`
        : `the person approved each document named in ${field}`;
    if (pattern === undefined) throw new Error(`No plugin describes ${fact}`);
    return pattern.state === "filed"
      ? `the ${pattern.kind} document is filed`
      : `the person approved the current version of the ${pattern.kind} document, or leaves approvals to you`;
  };
}

// The value names that no plugin declares, of those an action names.
const undeclared = (
  values: ReadonlyMap<string, ValueDeclaration>,
  named: readonly string[],
) => named.find((name) => !values.has(name));

// A namespace and a name, such as "brand.guidelines".
const VALUE_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

// Each handle several plugins share, with its default, the one that says so; exactly one must.
function sharedHandles<Each extends { builder: Plugin["builder"] }>(
  all: readonly Each[],
  packageOf: (each: Each) => string,
) {
  const byHandle = new Map<string, Each[]>();
  for (const each of all) {
    const { handle } = each.builder;
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), each]);
  }
  return [...byHandle].flatMap(([handle, sharing]) => {
    if (sharing.length === 1) return [];
    const defaults = sharing.filter(({ builder }) => builder.default);
    const [preset] = defaults;
    if (preset === undefined || defaults.length > 1)
      throw new Error(
        `${handle} is installed by ${sharing.map(packageOf).join(", ")}; exactly one of them must say "default": true in its builder block`,
      );
    return [{ handle, preset, sharing }];
  });
}

// Why a value's pattern or style is wrong, or undefined when it is right: a pattern is a regular
// expression, and only text has one or lives in the design's styles, one value to a token.
function valueProblem(
  value: ValueDeclaration,
  tokens: ReadonlyMap<string, string>,
) {
  const text = value.type === "text";
  if (value.pattern !== undefined) {
    if (!text) return "has a pattern, which only a text value takes";
    try {
      new RegExp(value.pattern);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return `has a pattern that is not a regular expression: ${error.message}`;
    }
  }
  if (value.style === undefined) return undefined;
  if (!text) return "lives in the design's styles, where only text can";
  const other = tokens.get(value.style.token);
  return other === undefined
    ? undefined
    : `lives in the design's ${value.style.token} token, as ${other} does`;
}

// Every project value by name: the selection of each handle several plugins share, then each a
// plugin declares. A value is declared once, so its words and type never disagree; any number of
// actions may read it.
function declaredValues(manifests: readonly Manifested[]) {
  const values = new Map<string, ValueDeclaration>();
  for (const { handle, preset, sharing } of sharedHandles(
    manifests,
    ({ about }) => about.package,
  ))
    values.set(selectionName(handle), {
      about: `Which ${handle} plugin this project uses, by package name: ${sharing.map(({ about }) => about.package).join(" or ")}. Without one it uses ${preset.about.package}.`,
      type: "text",
    });
  const owners = new Map<string, string>();
  const tokens = new Map<string, string>();
  for (const { builder } of manifests)
    for (const [name, value] of Object.entries(builder.values ?? {})) {
      if (!VALUE_NAME.test(name))
        throw new Error(
          `${builder.handle} declares ${name}, which is not a namespaced value name such as brand.guidelines`,
        );
      if (values.has(name))
        throw new Error(
          `${builder.handle} declares ${name}, which ${owners.get(name) ?? "Builder"} declares too`,
        );
      const problem = valueProblem(value, tokens);
      if (problem !== undefined)
        throw new Error(`${builder.handle} declares ${name}, which ${problem}`);
      if (value.style) tokens.set(value.style.token, name);
      values.set(name, value);
      owners.set(name, builder.handle);
    }
  for (const { builder, actions } of manifests)
    for (const [action, declared] of actions) {
      if (declared.kind === "check") continue;
      const unknown = undeclared(values, declared.builder.reads ?? []);
      if (unknown !== undefined)
        throw new Error(
          `${builder.handle} ${action} names ${unknown}, which no plugin declares as a project value`,
        );
      // A run saves only into the project's plain store, never into the design's styles.
      const unwritable =
        declared.kind === "workflow"
          ? declared.builder.writes?.find(
              (name) => !owners.has(name) || values.get(name)?.style,
            )
          : undefined;
      if (unwritable !== undefined)
        throw new Error(
          `${builder.handle} ${action} writes ${unwritable}, which no plugin declares as a project value kept in the project's store`,
        );
    }
  return values;
}

function installScreen(
  handle: string,
  action: string,
  { builder, definition: screen, data }: Extract<Declared, { kind: "screen" }>,
  {
    known,
    values,
    preferences,
    factText,
  }: Pick<Installing, "known" | "values" | "preferences" | "factText">,
): ScreenAction {
  const name = `${handle} ${action}`;
  const writes = Object.entries(screen.writes ?? {});
  const unknown = undeclared(
    values,
    writes.map(([value]) => value),
  );
  if (unknown !== undefined)
    throw new Error(
      `${name}'s screen writes ${unknown}, which no plugin declares as a project value`,
    );
  const prefers = Object.entries(screen.prefers ?? {});
  const unpreferred = prefers.find(([id]) => !preferences.has(id))?.[0];
  if (unpreferred !== undefined)
    throw new Error(
      `${name}'s screen prefers ${unpreferred}, which is not a preference Builder knows`,
    );
  const returns = builder.returns ?? [];
  const requires = builder.requires ?? [];
  checkFacts(name, [...requires.flat(), ...returns], known, (field) =>
    Object.hasOwn(screen.describe.fields, field),
  );
  if (returns.length > 0 !== (screen.approves !== undefined))
    throw new Error(
      returns.length > 0
        ? `${name} returns facts, but its screen approves nothing`
        : `${name}'s screen approves, but its manifest returns no facts`,
    );
  return {
    kind: "screen",
    plugin: handle,
    action,
    name,
    builder,
    when: screen.describe.when,
    unless: screen.describe.unless,
    description: screen.describe.summary,
    guidance: [
      guidanceText(name, screen, builder.reads ?? []),
      ...(requires.length > 0
        ? [`Requires: ${requiresText(requires, factText)}.`]
        : []),
      screenText(handle, action),
    ].join("\n"),
    refusal(input, project) {
      const validated = validateInput(name, screen, input, data, project);
      return validated.ok ? undefined : validated.text;
    },
    answer(raw) {
      const validated = validateOutput(name, screen, raw);
      if (!validated.ok) return validated;
      return {
        ok: true,
        values: Object.fromEntries(
          writes.map(([value, from]) => [value, from(validated.output)]),
        ),
        preferences: Object.fromEntries(
          prefers.map(([id, from]) => [id, from(validated.output)]),
        ),
        approves: screen.approves?.(validated.output) ?? [],
      };
    },
    returns: (input) => resolveFacts(returns, input),
  };
}

// What a check proves and how: its ready-made checks, or its definition's own code, and the input
// it takes. A ready-made check takes the fields its addresses and its facts name, each as text; its
// own code takes what its schema does.
function checkProof(
  name: string,
  builder: CheckActionBuilder,
  definition: Check<unknown>,
  known: ReadonlySet<Fact>,
) {
  const facts = [...(builder.requires ?? []).flat(), ...builder.returns];
  const { summary } = definition.describe;
  const { run, input } = definition;
  const proofs = builder.all ?? builder.any;
  if (proofs === undefined) {
    if (run === undefined || summary === undefined)
      throw new Error(
        `${name} declares no proofs in its manifest, so its definition needs a summary and a run of its own`,
      );
    checkFacts(name, facts, known, () => true);
    return {
      description: summary,
      input: input ? `Input: ${input.expression}` : "It takes no input.",
      validate: (raw: unknown) => validateCodeInput(name, definition, raw),
      run: async (view: ProjectView, given: unknown) => run(view, given),
      ms: CHECK_MS,
    };
  }
  if (run !== undefined || summary !== undefined)
    throw new Error(
      `${name} declares proofs in its manifest, which say what it proves, so its definition has no summary or run of its own`,
    );
  const proof = builder.all ? { all: proofs } : { any: proofs };
  const fields = [...new Set([...proofFields(proof), ...factFields(facts)])];
  checkFacts(name, facts, known, (field) => fields.includes(field));
  return {
    description: `Proves ${proofText(proof)}.`,
    input:
      fields.length === 0
        ? "It takes no input."
        : `Input: ${fields.join(", ")}, each an address as text.`,
    validate: (raw: unknown) => validateFields(name, fields, raw),
    run: async (view: ProjectView) => view.check(proof),
    ms: checkMs(proof),
  };
}

function installCheck(
  handle: string,
  action: string,
  { builder, definition }: Extract<Declared, { kind: "check" }>,
  { known, factText }: Pick<Installing, "known" | "factText">,
): CheckAction {
  const name = `${handle} ${action}`;
  const { description, input, validate, run, ms } = checkProof(
    name,
    builder,
    definition,
    known,
  );
  return {
    kind: "check",
    plugin: handle,
    action,
    name,
    builder,
    when: definition.describe.when,
    unless: definition.describe.unless,
    description,
    guidance: checkText(name, description, definition.describe, builder.speed, {
      requires: requiresText(builder.requires ?? [], factText),
      input,
    }),
    validate,
    run,
    ms,
    returns: (given) => resolveFacts(builder.returns, given),
  };
}

type Installing = {
  // Every fact the host works out or a check makes.
  known: ReadonlySet<Fact>;
  factText: (fact: Fact) => string;
  packs: readonly SkillPack[];
  values: ReadonlyMap<string, ValueDeclaration>;
  preferences: ReadonlySet<string>;
  starters: ReadonlyMap<string, Starter>;
};

// The finished work's line about the screens that show it, each with when it fits.
function presentsOf(
  name: string,
  handle: string,
  actions: Manifested["actions"],
  presents: readonly string[] | undefined,
) {
  if (presents === undefined) return null;
  return presentsText(
    handle,
    presents.map((screen) => {
      const declared = actions.get(screen);
      if (declared?.kind !== "screen")
        throw new Error(
          `${name} presents ${screen}, which is not a screen of ${handle}`,
        );
      return { action: screen, when: declared.definition.describe.when };
    }),
  );
}

function installAction(
  specialist: SpecialistBuilder,
  actions: Manifested["actions"],
  action: string,
  declared: Declared,
  installing: Installing,
): Action {
  const { handle } = specialist;
  if (declared.kind === "screen")
    return installScreen(handle, action, declared, installing);
  if (declared.kind === "check")
    return installCheck(handle, action, declared, installing);
  const { builder, definition: workflow } = declared;
  const { known, factText, packs, starters } = installing;
  const name = `${handle} ${action}`;
  const facts = [...(builder.requires ?? []).flat(), ...builder.returns];
  const requires = () =>
    `Requires: ${requiresText(builder.requires ?? [], factText)}.`;
  const { summary, when, unless, fields } = workflow.describe;
  checkFacts(name, facts, known, (field) => Object.hasOwn(fields, field));
  const { start } = builder;
  if (
    startsAgent(start) &&
    !Object.hasOwn(specialist.agents ?? {}, start.agent)
  )
    throw new Error(
      `${name} starts the agent ${start.agent}, which ${handle} does not declare`,
    );
  const started = startsAgent(start) ? start.agent : start.workflow;
  const starter = startsAgent(start)
    ? agentStarter(start.agent, builder.returns)
    : starters.get(start.workflow);
  if (!starter)
    throw new Error(
      `${name} starts ${started}, which is not an installed workflow`,
    );
  const problem = starter.check(start);
  if (problem !== undefined) throw new Error(`${name} start: ${problem}`);
  const unread = starter.reads.find((field) => !Object.hasOwn(fields, field));
  if (unread !== undefined)
    throw new Error(
      `${name} starts ${started}, which reads ${unread}, but its input has no ${unread}`,
    );
  const notCheck = builder.done?.find(
    (check) => actions.get(check)?.kind !== "check",
  );
  if (notCheck !== undefined)
    throw new Error(
      `${name} is done when ${notCheck} passes, which is not a check of ${handle}`,
    );
  return {
    kind: "workflow",
    plugin: handle,
    action,
    name,
    builder,
    when,
    unless,
    description: summary,
    guidance: [
      ...lines(name, workflow.describe, summary),
      requires(),
      ...suppliedText(builder.reads ?? []),
      inputText(fields),
    ].join("\n"),
    validate: (raw) => validateWorkflowInput(name, workflow, raw),
    presents: presentsOf(name, handle, actions, builder.presents),
    packs: packs.filter(({ serves }) => serves.includes(name)),
    workflow: started,
    starter,
    keep: (kept) => keptFor(name, workflow.record, builder.writes ?? [], kept),
  };
}

function keptFor(
  name: string,
  schema: Type | undefined,
  writes: readonly string[],
  { record, values }: Kept,
): KeptCheck {
  const unwritten = Object.keys(values ?? {}).find(
    (value) => !writes.includes(value),
  );
  if (unwritten !== undefined)
    return { ok: false, problem: `${name} does not write ${unwritten}` };
  if (record === undefined) return { ok: true, record };
  if (schema === undefined)
    return { ok: false, problem: `${name} declares no record` };
  const checked = schema(record);
  if (checked instanceof type.errors)
    return { ok: false, problem: `${name} record ${checked.summary}` };
  return { ok: true, record: checked };
}

function specialistPlugin(
  builder: SpecialistBuilder,
  declared: Manifested["actions"],
  about: Manifested["about"],
  installing: Installing,
): SpecialistPlugin {
  const { handle } = builder;
  const { description } = about;
  const { packs } = installing;
  const actions = [...declared].map(([name, each]) =>
    installAction(builder, declared, name, each, installing),
  );
  const own = packs
    .filter((pack) => pack.specialist === handle && pack.depth === 0)
    .map((pack) => pack.builder.handle);
  return {
    builder,
    package: about.package,
    label: about.label,
    description,
    actions,
    guidance: [
      ...lines(handle, builder, description),
      `Start one of its actions with execute({ plugin: "${handle}", action, input }), with the input that action describes; a screen opens the same way.`,
      ...(own.length > 0
        ? [
            `Its agent has skill packs it opens as the work calls for them, which are not started: ${own.join(", ")}.`,
          ]
        : []),
      ...actions.flatMap(({ guidance }) => ["", guidance]),
    ].join("\n"),
  };
}

async function readyPlanPlugin(
  found: Found,
  builder: ReadyPlanBuilder,
  about: Manifested["about"],
  known: ReadonlySet<Fact>,
): Promise<ReadyPlanPlugin> {
  const { description } = about;
  checkFacts(
    builder.handle,
    [
      ...builder.steps.flatMap((step) => [
        ...step.requires,
        ...approvalFacts(step.approval),
      ]),
      ...(builder.ends === undefined ? [] : [builder.ends]),
    ],
    known,
    () => false,
  );
  return {
    builder,
    package: about.package,
    label: about.label,
    description,
    guidance: [
      ...lines(builder.handle, builder, description),
      "",
      (await found.text(builder.guidance)).trim(),
    ].join("\n"),
  };
}

// Every action a ready-made plan names is an action of each installed specialist with its handle, so
// whichever of them a project uses has it. A screen is a step too: asking the person is work.
function checkCatalog(plugins: readonly Plugin[]) {
  const specialists = plugins.filter(isSpecialist);
  const offered = (handle: string, name: string) => {
    const sharing = specialists.filter(
      ({ builder }) => builder.handle === handle,
    );
    return (
      sharing.length > 0 &&
      sharing.every(({ actions }) =>
        actions.some((action) => action.action === name),
      )
    );
  };
  for (const { builder } of plugins)
    if (builder.runs === "plan")
      for (const step of builder.steps)
        if (!offered(step.plugin, step.action))
          throw new Error(
            `${builder.handle} names ${step.plugin} ${step.action}, which is not an installed action of every plugin with that handle`,
          );
}

// A ready-made plan's step asks for the person's go-ahead only through its approval, so what it
// requires names no fact that only a screen's answer makes true. And no step the person may not
// decline needs a fact that only steps they may decline make true in the same plan, since
// declining those would leave the plan with no way on.
function checkReadyPlanSteps(plugins: readonly Plugin[]) {
  const actions = plugins
    .filter(isSpecialist)
    .flatMap(({ actions }) => actions);
  const goAhead = (fact: Fact) => {
    const makers = actions.filter((action) =>
      (action.builder.returns ?? []).some((made) => makes(made, fact)),
    );
    return makers.length > 0 && makers.every(isScreenAction);
  };
  for (const { builder } of plugins) {
    if (builder.runs !== "plan") continue;
    for (const step of builder.steps) {
      const gate = step.requires.find(goAhead);
      if (gate !== undefined)
        throw new Error(
          `${builder.handle}'s step ${step.plugin} ${step.action} requires ${gate}, which only the person's answer makes true; say it with approval instead`,
        );
    }
    const making = builder.steps.map((step) => {
      const returns =
        actions.find(
          (action) =>
            action.plugin === step.plugin && action.action === step.action,
        )?.builder.returns ?? [];
      return {
        step,
        made: step.input ? resolveFacts(returns, step.input) : returns,
      };
    });
    for (const { step } of making) {
      if (step.optional) continue;
      for (const fact of step.requires) {
        const makers = making.filter((maker) =>
          maker.made.some((each) => makes(each, fact)),
        );
        const optional = makers.find((maker) => maker.step.optional);
        if (optional && makers.every((maker) => maker.step.optional))
          throw new Error(
            `${builder.handle}'s step ${step.plugin} ${step.action} needs ${fact}, which only its optional step ${optional.step.plugin} ${optional.step.action} makes true; declining that step would leave the plan with no way on, so make it required or drop ${fact} from what the step needs`,
          );
      }
    }
  }
}

// Each pack with the specialist its chain of extends reaches and the workflow actions every pack in
// that chain serves, ordered as a tree: each pack before the packs that narrow it.
async function loadPacks(
  packs: readonly ReturnType<typeof packOf>[],
  manifests: readonly Manifested[],
): Promise<SkillPack[]> {
  const handles = new Set(manifests.map(({ builder }) => builder.handle));
  const byHandle = new Map<string, SkillsBuilder>();
  for (const { builder } of packs) {
    if (handles.has(builder.handle) || byHandle.has(builder.handle))
      throw new Error(`${builder.handle} is installed twice`);
    byHandle.set(builder.handle, builder);
  }
  const loaded = await Promise.all(
    packs.map(async ({ found, builder }) => {
      // The pack, then each pack it narrows, up to the one that extends the specialist.
      const chain = [builder];
      for (
        let parent = byHandle.get(builder.extends);
        parent;
        parent = byHandle.get(parent.extends)
      ) {
        if (chain.includes(parent))
          throw new Error(`${builder.handle} extends itself`);
        chain.push(parent);
      }
      const top = chain[chain.length - 1]!;
      const extended = manifests.find(
        (manifest) => manifest.builder.handle === top.extends,
      );
      const specialist = extended?.builder;
      if (extended === undefined || specialist?.runs !== "specialist")
        throw new Error(
          `${top.handle} extends ${top.extends}, which is not an installed specialist or skill pack`,
        );
      const unknown = builder.actions?.find(
        (action) => !Object.hasOwn(specialist.actions, action),
      );
      if (unknown !== undefined)
        throw new Error(
          `${builder.handle} names ${unknown}, which is not an action of ${specialist.handle}`,
        );
      const files = await found.files(builder.skills);
      if (Object.keys(files).length === 0)
        throw new Error(
          `${builder.handle}'s skills ${builder.skills} holds no files`,
        );
      return {
        builder,
        specialist: specialist.handle,
        serves: [...extended.actions]
          .filter(
            ([action, declared]) =>
              declared.kind === "workflow" &&
              chain.every(
                (pack) => !pack.actions || pack.actions.includes(action),
              ),
          )
          .map(([action]) => `${specialist.handle} ${action}`),
        path: chain
          .map((pack) => pack.handle)
          .reverse()
          .join("/"),
        depth: chain.length - 1,
        files,
      };
    }),
  );
  const narrowing = (extended: string): SkillPack[] =>
    loaded
      .filter((pack) => pack.builder.extends === extended)
      .sort((a, b) => a.builder.handle.localeCompare(b.builder.handle))
      .flatMap((pack) => [pack, ...narrowing(pack.builder.handle)]);
  return [...new Set(loaded.map((pack) => pack.specialist))].flatMap(narrowing);
}

// Each workflow a plugin starts itself, by the name its actions' start blocks give it.
async function pluginStarters(manifests: readonly Manifested[]) {
  const starters = new Map<string, Starter>();
  for (const { found, builder } of manifests) {
    if (builder.runs !== "specialist") continue;
    for (const [workflow, path] of Object.entries(builder.starters ?? {})) {
      if (starters.has(workflow))
        throw new Error(
          `${builder.handle} starts ${workflow}, which another starter starts too`,
        );
      const starter = await found.module(path);
      if (!isStarter(starter))
        throw new Error(
          `${builder.handle}'s starter ${path} has no starter as its default export`,
        );
      starters.set(workflow, starter);
    }
  }
  return starters;
}

// Each declared agent's package: its prompt's text and the role it plays, its reply waiting for a
// filed document when every action starting it files one.
async function agentPackages(
  found: Found,
  builder: SpecialistBuilder,
  actions: Manifested["actions"],
) {
  const starting = [...actions.values()].flatMap((declared) =>
    declared.kind === "workflow" ? [declared.builder] : [],
  );
  return Promise.all(
    Object.entries(builder.agents ?? {}).map(async ([name, declared]) => {
      const actions = starting.filter(
        ({ start }) => startsAgent(start) && start.agent === name,
      );
      const role = declaredRole(builder, declared.role);
      const agent: AgentPackage = {
        name,
        prompt: (await found.text(declared.prompt)).trim(),
        role,
        fileBeforeDone:
          actions.length > 0 &&
          actions.every(({ returns }) =>
            returns.some((fact) => fact.startsWith("filed:")),
          ),
      };
      return [name, { role: role.name, agent }] as const;
    }),
  );
}

// The host's model settings and output budgets with every one the specialists declare. Plugins may
// declare one name alike, so each runs without the others; told apart, a name would run differently
// by which plugin is installed.
function declaredModels(manifests: readonly Manifested[], host: Host) {
  const settings = new Map(host.settings);
  const budgets = new Map(host.budgets);
  const declare = <T extends object>(
    into: Map<string, T>,
    what: string,
    where: string,
    declared: Readonly<Record<string, T>> | undefined,
  ) => {
    for (const [name, declaration] of Object.entries(declared ?? {})) {
      const known = into.get(name);
      if (known && !alike(known, declaration))
        throw new Error(`${where} declares ${what} ${name} unlike another`);
      into.set(name, declaration);
    }
  };
  for (const { builder, about } of manifests) {
    if (builder.runs !== "specialist") continue;
    declare(settings, "model setting", about.package, builder.settings);
    declare(budgets, "output budget", about.package, builder.budgets);
  }
  return { settings, budgets };
}

const alike = (one: object, other: object) => {
  const entries = Object.entries(one);
  return (
    entries.length === Object.keys(other).length &&
    entries.every(([key, value]) => Reflect.get(other, key) === value)
  );
};

// Every role the specialists declare, each checked against what the host runs: a model setting, an
// output budget and preferences it has. No two plugins declare one name, whose runs would be
// indistinguishable.
function declaredRoles(
  manifests: readonly Manifested[],
  host: Host,
  models: ReturnType<typeof declaredModels>,
) {
  const roles = new Map<string, Role>();
  for (const { builder, about } of manifests) {
    if (builder.runs !== "specialist") continue;
    for (const role of builder.roles ?? []) {
      const where = `${about.package}'s role ${role.name}`;
      if (roles.has(role.name))
        throw new Error(`${where} is declared by another plugin too`);
      if (!models.settings.has(role.model))
        throw new Error(`${where} runs on ${role.model}, no model setting`);
      if (!models.budgets.has(role.limits))
        throw new Error(`${where} has limits ${role.limits}, no output budget`);
      const unknown = (role.preferences ?? []).find(
        (id) => !host.preferences.has(id),
      );
      if (unknown !== undefined)
        throw new Error(`${where} reads ${unknown}, no preference`);
      roles.set(role.name, role);
    }
  }
  return roles;
}

// Each workflow package a plugin brings, by name: at its entry's path in the plugins folder, or the
// agent it declares.
async function pluginPackages(manifests: readonly Manifested[]) {
  const packages = new Map<string, PluginPackage>();
  // Two plugins with one handle may well bring a package of the same name, which only one can be.
  const owners = new Map<string, string>();
  for (const { found, builder, about, actions } of manifests) {
    if (builder.runs !== "specialist") continue;
    for (const [name, brought] of [
      ...Object.entries(builder.packages ?? {}).map(
        ([name, { entry, role }]) =>
          [
            name,
            {
              entry: join(found.folder, entry),
              role: declaredRole(builder, role).name,
            },
          ] as const,
      ),
      ...(await agentPackages(found, builder, actions)),
    ]) {
      const other = owners.get(name);
      if (other !== undefined)
        throw new Error(
          `${about.package} installs the workflow package ${name}, which ${other} installs too`,
        );
      packages.set(name, brought);
      owners.set(name, about.package);
    }
  }
  return packages;
}

// Every starter the specialists declare, by name, with its folder's files; no two plugins declare
// one name, and at most one starter is the legacy default.
async function appStarters(manifests: readonly Manifested[]) {
  const starters = new Map<string, StarterFiles>();
  for (const { found, builder, about } of manifests) {
    if (builder.runs !== "specialist") continue;
    for (const [name, starter] of Object.entries(builder.appStarters ?? {})) {
      if (starters.has(name))
        throw new Error(
          `${about.package}'s starter ${name} is declared by another plugin too`,
        );
      starters.set(name, {
        ...starter,
        files: await found.files(starter.folder),
      });
    }
  }
  const legacy = [...starters].filter(([, { legacyDefault }]) => legacyDefault);
  if (legacy.length > 1)
    throw new Error(
      `${legacy.map(([name]) => name).join(" and ")} are each the legacy default starter; at most one may be`,
    );
  return { starters, legacy: legacy[0] };
}

// A plugin's themes folder as each theme's files, by the folder each sits in, which is its id.
function byTheme(files: Readonly<Record<string, string>>) {
  const themes = new Map<string, Record<string, string>>();
  for (const [path, text] of Object.entries(files)) {
    const [id, ...rest] = path.split("/");
    if (id === undefined || rest.length === 0) continue;
    themes.set(id, { ...themes.get(id), [rest.join("/")]: text });
  }
  return themes;
}

// The design workspace the one plugin that declares it brings, read: each look starts from one of
// its themes.
async function declaredDesign(
  manifests: readonly Manifested[],
): Promise<Design | undefined> {
  const declaring = manifests.flatMap(({ found, builder, about }) =>
    builder.runs === "specialist" && builder.design
      ? [{ found, design: builder.design, about }]
      : [],
  );
  if (declaring.length > 1)
    throw new Error(
      `${declaring.map(({ about }) => about.package).join(" and ")} each declare a design workspace; at most one may`,
    );
  const [declared] = declaring;
  if (declared === undefined) return undefined;
  const { found, design, about } = declared;
  const themes = byTheme(
    design.themes === undefined ? {} : await found.files(design.themes),
  );
  const unthemed = design.looks.find(
    ({ theme }) => theme !== undefined && !themes.has(theme),
  );
  if (unthemed !== undefined)
    throw new Error(
      `${about.package}'s look ${unthemed.id} starts from ${unthemed.theme}, which is not one of its themes`,
    );
  return {
    starter:
      design.starter === undefined ? {} : await found.files(design.starter),
    themes,
    looks: design.looks,
    themeOf: (label) => {
      const look = lookOf(design, label);
      return look && design.looks.find(({ id }) => id === look.theme);
    },
  };
}

// Of each handle several plugins share, the one these project values select, else the default.
function choose(
  shared: ReturnType<typeof sharedHandles<Plugin>>,
  values: Readonly<Record<string, unknown>>,
) {
  return shared.map(({ handle, preset, sharing }): Choice => {
    const selected = values[selectionName(handle)];
    const using =
      sharing.find((plugin) => plugin.package === selected) ?? preset;
    const choice: Choice = {
      handle,
      using,
      others: sharing.filter((plugin) => plugin !== using),
    };
    if (typeof selected === "string" && selected !== using.package)
      choice.missing = selected;
    return choice;
  });
}

/** The plugins found, each checked against its manifest and the host; a wrong one is thrown. */
export async function loadCatalog(
  found: readonly Found[],
  host: Host,
): Promise<Catalog> {
  const manifests = await Promise.all(
    found.filter((each) => !RunsSkills.allows(each.manifest)).map(manifested),
  );
  const packs = await loadPacks(
    found.filter((each) => RunsSkills.allows(each.manifest)).map(packOf),
    manifests,
  );
  const made = checkMade(manifests);
  const known = new Set([...host.facts, ...made.keys()]);
  const factText = factWords(manifests, host.facts, made);
  const values = declaredValues(manifests);
  const starters = await pluginStarters(manifests);
  const plugins = await Promise.all(
    manifests.map(
      async ({ found, builder, about, actions }): Promise<Plugin> => {
        if (builder.runs === "specialist")
          return specialistPlugin(builder, actions, about, {
            known,
            factText,
            packs,
            values,
            preferences: host.preferences,
            starters,
          });
        return readyPlanPlugin(found, builder, about, known);
      },
    ),
  );
  checkCatalog(plugins);
  checkReadyPlanSteps(plugins);
  const models = declaredModels(manifests, host);
  const roles = declaredRoles(manifests, host, models);
  const packages = await pluginPackages(manifests);
  const code = await appStarters(manifests);
  const design = await declaredDesign(manifests);
  const shared = sharedHandles(plugins, (plugin) => plugin.package);
  // The one place the installed plugins are narrowed to one per handle.
  const catalogOf = (choices: readonly Choice[]): Catalog => {
    const using = plugins.filter((plugin) =>
      choices.every(
        (choice) =>
          choice.handle !== plugin.builder.handle || choice.using === plugin,
      ),
    );
    const actions = using
      .filter(isSpecialist)
      .flatMap(({ actions }) => actions);
    return {
      plugins: using,
      screens: actions.filter(isScreenAction),
      actions,
      installed: (handle) =>
        using.find((plugin) => plugin.builder.handle === handle),
      factText,
      values,
      packages,
      roles: [...roles.values()],
      role: (name) => roles.get(name),
      settings: models.settings,
      budgets: models.budgets,
      appStarters: code.starters,
      legacyStarter: code.legacy && {
        name: code.legacy[0],
        starter: code.legacy[1],
      },
      design,
      choices,
      select: (selected) => catalogOf(choose(shared, selected)),
    };
  };
  return catalogOf(choose(shared, {}));
}
