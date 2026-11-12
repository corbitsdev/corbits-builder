import { type } from "arktype";
import {
  checkInput,
  checkWorkflowInput,
  guidanceText,
  inputText,
  isScreen as isScreenModule,
  isWorkflow,
  RouteBuilder,
  SkillsBuilder,
  SpecialistBuilder,
  type Fact,
  type ProjectValues,
  type Refused,
  type ScreenActionBuilder,
  type ToolActionBuilder,
  type ValueDeclaration,
  type WorkflowActionBuilder,
} from "@corbits-builder/plugin";
import { patternFact, templateField } from "./facts.ts";
import type { Found } from "./folder.ts";
import {
  presentsText,
  requiresText,
  screenText,
  suppliedText,
} from "./text.ts";

/** What a host supplies the catalog: all it needs that the plugins themselves cannot say. */
export type Host = {
  // Every fact the host works out from what it stores.
  facts: ReadonlySet<Fact>;
  // The project values the host keeps in a home of its own, such as design tokens; every value a
  // plugin declares is kept in the project's plain store.
  values: Readonly<Record<string, ValueDeclaration>>;
  // How the host starts workflow actions, by the workflow a manifest's start block names.
  starters: Readonly<Record<string, Starter>>;
};

export type Starter = {
  // Why a start block is wrong for this starter, or undefined when it takes it.
  check(start: WorkflowActionBuilder["start"]): string | undefined;
  // The input fields it reads, which every action it starts must take.
  reads: readonly string[];
};

// The builder block of whichever kind the manifest says it runs.
const Manifest = type({
  "description?": "string",
  builder: SpecialistBuilder.or(RouteBuilder),
});
// A skill pack's manifest, told apart from a plugin's by what it runs before either is checked.
const RunsSkills = type({ builder: { runs: "'skills'" } });
const PackManifest = type({ builder: SkillsBuilder });

type Base = {
  description: string;
  // What the coordinator reads to use it.
  guidance: string;
};
type ActionBase = Base & {
  plugin: string;
  action: string;
  // How the coordinator's messages name it, such as "coder change".
  name: string;
};
export type WorkflowAction = ActionBase & {
  builder: WorkflowActionBuilder;
  // The input checked for the host's starter, or the refusal when it is wrong.
  check: (input: unknown) => { ok: true; input: unknown } | Refused;
  // What its finished run's report adds about the screen that shows the work, or null for none.
  presents: string | null;
  // The skill packs its specialist's agent is given when this action starts it.
  packs: readonly SkillPack[];
};
export type ToolAction = ActionBase & { builder: ToolActionBuilder };
export type ScreenAction = ActionBase & {
  builder: ScreenActionBuilder;
  // Why this input cannot be shown, or undefined when it can.
  refusal: (input: unknown, project: ProjectValues) => string | undefined;
};
export type Action = WorkflowAction | ToolAction | ScreenAction;

export type SpecialistPlugin = Base & {
  builder: SpecialistBuilder;
  actions: readonly Action[];
};
export type RoutePlugin = Base & { builder: RouteBuilder };
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
export type Plugin = SpecialistPlugin | RoutePlugin;

export type Catalog = {
  plugins: readonly Plugin[];
  // The screens a question can show.
  screens: readonly ScreenAction[];
  // Every action of every specialist: started with execute or its own tool, or opened with question.
  actions: readonly Action[];
  installed(handle: string): Plugin | undefined;
  // A fact in plain words.
  factText(fact: Fact): string;
  // Every project value by name: the host's own and each one a plugin declares.
  values: ReadonlyMap<string, ValueDeclaration>;
};

export const isSpecialist = (plugin: Plugin): plugin is SpecialistPlugin =>
  plugin.builder.runs === "specialist";
export const isRoute = (plugin: Plugin): plugin is RoutePlugin =>
  plugin.builder.runs === "route";
export const isWorkflowAction = (action: Action): action is WorkflowAction =>
  action.builder.runs === "workflow";
export const isScreenAction = (action: Action): action is ScreenAction =>
  action.builder.runs === "screen";

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
  const { builder, description = "" } = manifest;
  return { found, builder, description };
}
type Manifested = ReturnType<typeof manifestOf>;

function packOf(found: Found) {
  const manifest = PackManifest(found.manifest);
  if (manifest instanceof type.errors)
    throw new Error(
      `plugins/${found.folder}/package.json: ${manifest.summary}`,
    );
  return { found, builder: manifest.builder };
}

/** The files a manifest names: the modules the catalog imports, the texts it reads and the folders it lays out. */
export function manifestFiles(found: Found) {
  if (RunsSkills.allows(found.manifest))
    return { modules: [], texts: [], folders: [packOf(found).builder.skills] };
  const { builder } = manifestOf(found);
  if (builder.runs === "specialist")
    return {
      modules: Object.values(builder.actions).flatMap((action) => {
        if (action.runs === "workflow") return [action.input];
        if (action.runs === "tool") return [];
        return action.data === undefined
          ? [action.screen]
          : [action.screen, action.data];
      }),
      texts: [],
      folders: [],
    };
  return { modules: [], texts: [builder.guidance], folders: [] };
}

// Refuses a fact that is neither one the host works out nor a template on a field the plugin takes.
function checkFacts(
  name: string,
  facts: readonly Fact[],
  known: ReadonlySet<Fact>,
  takes: (field: string) => boolean,
) {
  const unknown = facts.find((fact) => {
    const field = templateField(fact);
    return field === undefined ? !known.has(fact) : !takes(field);
  });
  if (unknown !== undefined)
    throw new Error(
      `${name} names ${unknown}, which is not a fact Builder knows`,
    );
}

// Each fact in the words of the one plugin that describes it. Every fact the host works out has
// words, except a fact about one kind of document, which reads well enough from the kind.
function factWords(manifests: readonly Manifested[], known: ReadonlySet<Fact>) {
  const words = new Map<Fact, { handle: string; text: string }>();
  for (const { builder } of manifests)
    for (const [fact, text] of Object.entries(builder.facts ?? {})) {
      if (!known.has(fact))
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
  for (const fact of known)
    if (!patternFact(fact) && !words.has(fact))
      throw new Error(`Builder works out ${fact}, but no plugin describes it`);
  return (fact: Fact): string => {
    const described = words.get(fact)?.text;
    if (described !== undefined) return described;
    const field = templateField(fact);
    const pattern = patternFact(fact);
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

// A namespace and a name, such as "brand.guidelines".
const VALUE_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

// Every project value by name: the host's own, then each a plugin declares. A value is declared
// once, so its words and type never disagree; any number of actions may read it.
function declaredValues(manifests: readonly Manifested[], host: Host) {
  const values = new Map(Object.entries(host.values));
  const owners = new Map<string, string>();
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
      values.set(name, value);
      owners.set(name, builder.handle);
    }
  for (const { builder } of manifests) {
    if (builder.runs !== "specialist") continue;
    for (const [action, declared] of Object.entries(builder.actions)) {
      if (declared.runs === "tool") continue;
      const named = [
        ...(declared.reads ?? []),
        ...(declared.runs === "screen" ? (declared.writes ?? []) : []),
      ];
      const unknown = named.find((name) => !values.has(name));
      if (unknown !== undefined)
        throw new Error(
          `${builder.handle} ${action} names ${unknown}, which no plugin declares as a project value`,
        );
    }
  }
  return values;
}

async function installScreen(
  found: Found,
  handle: string,
  action: string,
  declared: ScreenActionBuilder,
): Promise<ScreenAction> {
  const name = `${handle} ${action}`;
  const screen = await found.module(declared.screen);
  if (!isScreenModule(screen))
    throw new Error(
      `${name}'s screen ${declared.screen} has no screen as its default export`,
    );
  let data: unknown;
  if (declared.data !== undefined) {
    if (!screen.data)
      throw new Error(
        `${name} names data ${declared.data}, but its screen declares no data schema`,
      );
    data = screen.data.assert(await found.module(declared.data));
  }
  return {
    plugin: handle,
    action,
    name,
    builder: declared,
    description: screen.describe.summary,
    guidance: [
      guidanceText(name, screen, declared.reads ?? []),
      screenText(handle, action),
    ].join("\n"),
    refusal(input, project) {
      const checked = checkInput(name, screen, input, data, project);
      return checked.ok ? undefined : checked.text;
    },
  };
}

async function installAction(
  found: Found,
  handle: string,
  action: string,
  declared: SpecialistBuilder["actions"][string],
  {
    host,
    factText,
    packs,
  }: {
    host: Host;
    factText: (fact: Fact) => string;
    packs: readonly SkillPack[];
  },
): Promise<Action> {
  if (declared.runs === "screen")
    return installScreen(found, handle, action, declared);
  const name = `${handle} ${action}`;
  const facts = [...(declared.requires ?? []).flat(), ...declared.returns];
  const requires = () =>
    `Requires: ${requiresText(declared.requires ?? [], factText)}.`;
  if (declared.runs === "tool") {
    // The input is its own tool's, which the host defines, so any field may be templated.
    checkFacts(name, facts, host.facts, () => true);
    return {
      plugin: handle,
      action,
      name,
      builder: declared,
      description: declared.summary,
      guidance: [...lines(name, declared, declared.summary), requires()].join(
        "\n",
      ),
    };
  }
  const workflow = await found.module(declared.input);
  if (!isWorkflow(workflow))
    throw new Error(
      `${name}'s input ${declared.input} has no workflow as its default export`,
    );
  const { fields } = workflow.describe;
  checkFacts(name, facts, host.facts, (field) => Object.hasOwn(fields, field));
  const starter = host.starters[declared.start.workflow];
  if (!starter)
    throw new Error(
      `${name} starts ${declared.start.workflow}, which is not an installed workflow`,
    );
  const problem = starter.check(declared.start);
  if (problem !== undefined) throw new Error(`${name} start: ${problem}`);
  const unread = starter.reads.find((field) => !Object.hasOwn(fields, field));
  if (unread !== undefined)
    throw new Error(
      `${name} starts ${declared.start.workflow}, which reads ${unread}, but its input has no ${unread}`,
    );
  return {
    plugin: handle,
    action,
    name,
    builder: declared,
    description: workflow.describe.summary,
    guidance: [
      ...lines(name, declared, workflow.describe.summary),
      requires(),
      ...suppliedText(declared.reads ?? []),
      inputText(fields),
    ].join("\n"),
    check: (raw) => checkWorkflowInput(name, workflow, raw),
    presents:
      declared.presents === undefined
        ? null
        : presentsText(handle, declared.presents),
    packs: packs.filter(({ serves }) => serves.includes(name)),
  };
}

async function specialistPlugin(
  found: Found,
  builder: SpecialistBuilder,
  description: string,
  host: Host,
  factText: (fact: Fact) => string,
  packs: readonly SkillPack[],
): Promise<SpecialistPlugin> {
  const { handle } = builder;
  const actions = await Promise.all(
    Object.entries(builder.actions).map(([name, declared]) =>
      installAction(found, handle, name, declared, { host, factText, packs }),
    ),
  );
  const own = packs
    .filter((pack) => pack.specialist === handle && pack.depth === 0)
    .map((pack) => pack.builder.handle);
  return {
    builder,
    description,
    actions,
    guidance: [
      ...lines(handle, builder, description),
      `Start one of its actions with execute({ plugin: "${handle}", action, input }), with the input that action describes; an action started with a tool of its own, or a screen opened with question, says so.`,
      ...(own.length > 0
        ? [
            `Its agent has skill packs it opens as the work calls for them, which are not started: ${own.join(", ")}.`,
          ]
        : []),
      ...actions.flatMap(({ guidance }) => ["", guidance]),
    ].join("\n"),
  };
}

async function routePlugin(
  found: Found,
  builder: RouteBuilder,
  description: string,
  host: Host,
): Promise<RoutePlugin> {
  checkFacts(
    builder.handle,
    [...builder.steps.flatMap((step) => step.requires), builder.outcome],
    host.facts,
    () => false,
  );
  return {
    builder,
    description,
    guidance: [
      ...lines(builder.handle, builder, description),
      "",
      (await found.text(builder.guidance)).trim(),
    ].join("\n"),
  };
}

// Every handle once, every action a route names among the installed workflow actions, and every
// screen an action presents among its own plugin's screens.
function checkCatalog(plugins: readonly Plugin[]) {
  const handles = new Set<string>();
  for (const { builder } of plugins) {
    if (handles.has(builder.handle))
      throw new Error(`${builder.handle} is installed twice`);
    handles.add(builder.handle);
  }
  for (const { actions } of plugins.filter(isSpecialist))
    for (const action of actions.filter(isWorkflowAction)) {
      const { presents } = action.builder;
      if (
        presents !== undefined &&
        !actions.some(
          (screen) => isScreenAction(screen) && screen.action === presents,
        )
      )
        throw new Error(
          `${action.name} presents ${presents}, which is not a screen of ${action.plugin}`,
        );
    }
  const started = plugins
    .filter(isSpecialist)
    .flatMap(({ actions }) => actions.filter(isWorkflowAction))
    .map(({ name }) => name);
  for (const { builder } of plugins)
    if (builder.runs === "route")
      for (const step of builder.steps)
        if (!started.includes(`${step.plugin} ${step.action}`))
          throw new Error(
            `${builder.handle} names ${step.plugin} ${step.action}, which is not an installed workflow action`,
          );
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
      const specialist = manifests.find(
        (manifest) => manifest.builder.handle === top.extends,
      )?.builder;
      if (specialist?.runs !== "specialist")
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
        serves: Object.entries(specialist.actions)
          .filter(
            ([action, declared]) =>
              declared.runs === "workflow" &&
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

/** The plugins found, each checked against its manifest and the host; a wrong one is thrown. */
export async function loadCatalog(
  found: readonly Found[],
  host: Host,
): Promise<Catalog> {
  const manifests = found
    .filter((each) => !RunsSkills.allows(each.manifest))
    .map(manifestOf);
  const packs = await loadPacks(
    found.filter((each) => RunsSkills.allows(each.manifest)).map(packOf),
    manifests,
  );
  const factText = factWords(manifests, host.facts);
  const values = declaredValues(manifests, host);
  const plugins = await Promise.all(
    manifests.map(({ found, builder, description }): Promise<Plugin> => {
      if (builder.runs === "specialist")
        return specialistPlugin(
          found,
          builder,
          description,
          host,
          factText,
          packs,
        );
      return routePlugin(found, builder, description, host);
    }),
  );
  checkCatalog(plugins);
  const actions = plugins
    .filter(isSpecialist)
    .flatMap(({ actions }) => actions);
  return {
    plugins,
    screens: actions.filter(isScreenAction),
    actions,
    installed: (handle) =>
      plugins.find((plugin) => plugin.builder.handle === handle),
    factText,
    values,
  };
}
