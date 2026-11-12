import { type, type Type } from "arktype";
import type { WorkflowAction } from "@corbits-builder/plugin-host/catalog";
import type { Started } from "@corbits-builder/plugin-host/coordinator";
import { coderTaskMessage } from "@corbits-builder/coder/contract";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import {
  DOCUMENT_WRITER_PACKAGE,
  WRITER_PACKAGES,
} from "@corbits-builder/schemas/installed-workflows";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  DESIGNER_INPUTS,
  NO_DOCUMENTS_NOTE,
  skillPacksIndex,
  startHere,
} from "../config/inputs.ts";
import { DEFAULT_STACK } from "../config/packages.ts";
import {
  Refusal,
  type ProjectListing,
  type ProjectSession,
} from "../projects/project-session.ts";
import { writerTask } from "../workflows/writer-task.ts";

export const APP_ALREADY_EXISTS =
  "The project already has an app, so its first build is done. A change to it is coder change.";

// What runs({ ... }) offers for a run that holds back the next one, named as runIds lists it.
const waitOrStop = (runIds: string) =>
  `runs({ operation: "wait", runIds: [${runIds}] }) waits for it to end, or runs({ operation: "stop", runIds: [${runIds}] }) stops it; then call execute again.`;

// One coder works on the app at a time: the project has one app repository, and a second coder
// would start from the app without the first one's work and overwrite it when it saves. Without
// live, the other coder is still starting, from another execute in the same turn.
function coderBusy(live?: { runId: string; state: string }) {
  const other =
    live === undefined
      ? "Another coder is starting on the app from an execute call in this same turn"
      : `The coder in run ${live.runId} is ${live.state === "waiting" ? "saving its last files after its report" : "still at work on the app"}`;
  const next =
    live === undefined
      ? `That call returns its run id. ${waitOrStop("its run id")}`
      : waitOrStop(JSON.stringify(live.runId));
  return new Refusal(
    `The coder was not started. ${other}, and one coder works on the app at a time because the project has one app repository: a second coder would start without that run's work and overwrite it. ${next} Giving each coder its own branch of the app, merged when it finishes, would lift this.`,
  );
}

// A design concept is one designer's: the hub files that run's design as the concept's option.
const conceptBusy = (concept: string, runId: string) =>
  `the ${concept} designer in run ${runId} is still at work, and a concept is one designer's because its design is filed as that concept's option. ${waitOrStop(JSON.stringify(runId))} A new concept label starts alongside it.`;

// A started run of one specialist.
const one = ({ runId }: { runId: string }): Started => ({
  runs: [{ runId }],
  notStarted: [],
});

// One installed workflow a plugin action starts: start is the action's start block, input the
// action's checked input, of which the starter reads only its own fields, and skills the index of
// the action's skill packs for the assignment.
function starter<Start extends Type, Input extends Type<object>>(
  start: Start,
  input: Input,
  run: (
    start: Start["infer"],
    input: Input["infer"],
    session: ProjectSession,
    skills: string,
  ) => Promise<Started>,
) {
  return {
    check(raw: unknown) {
      const checked = start(raw);
      return checked instanceof type.errors ? checked.summary : undefined;
    },
    reads: input.props.map(({ key }) => String(key)),
    run: (
      raw: unknown,
      checked: unknown,
      session: ProjectSession,
      skills: string,
    ) => run(start.assert(raw), input.assert(checked), session, skills),
  };
}

const Instructed = type({ instruction: "string" });

// The filed documents a coder works from, and the chosen design when there is one; with neither,
// the note that the instruction is the whole assignment.
function coderDocuments(
  session: ProjectSession,
  byKind: ProjectListing["byKind"],
) {
  const kinds = CODER_INPUTS.filter((kind) => byKind.has(kind));
  const design = byKind.get("design")?.version;
  if (kinds.length === 0 && design === undefined) return NO_DOCUMENTS_NOTE;
  return startHere(session.inputs(kinds, byKind), design);
}

// A first build refuses a project that has an app; a change starts from the app as last saved. A
// coder still on the app refuses at once rather than wait for it.
const coder = starter(
  type({
    "+": "reject",
    workflow: "'coder'",
    correlation: "string > 0",
    app: "'new' | 'existing'",
  }),
  Instructed,
  async ({ correlation, app }, { instruction }, session, skills) => {
    const { inFlight } = await session.listed();
    const live = inFlight.find((run) => run.role === "coder");
    if (live) throw coderBusy(live);
    return one(
      await session.startCoder(
        correlation,
        ({ byKind }) => {
          if (app === "existing")
            return (
              coderDocuments(session, byKind) +
              skills +
              APP_CHANGE_NOTE +
              coderTaskMessage(instruction)
            );
          if (byKind.has("app")) throw new Refusal(APP_ALREADY_EXISTS);
          return (
            coderDocuments(session, byKind) +
            skills +
            coderTaskMessage(instruction)
          );
        },
        coderBusy,
      ),
    );
  },
);

const designer = starter(
  type({ "+": "reject", workflow: "'designer'" }),
  type({
    instruction: "string",
    lookIdeas: "string",
    concepts: DesignConcept.array(),
  }),
  async (_start, input, session, skills) => {
    // A concept whose designer is still at work is refused at once; the others start.
    const { inFlight } = await session.listed();
    const busy = new Map(
      inFlight.flatMap((run) =>
        run.role === "designer" && run.concept
          ? [[run.concept, run.runId]]
          : [],
      ),
    );
    const notStarted: Started["notStarted"] = [];
    for (const { label } of input.concepts) {
      const runId = busy.get(label);
      if (runId)
        notStarted.push({ concept: label, reason: conceptBusy(label, runId) });
    }
    const concepts = input.concepts.filter(({ label }) => !busy.has(label));
    if (concepts.length === 0)
      throw new Refusal(
        "No designer was started: " +
          notStarted.map(({ reason }) => reason).join(" "),
      );
    const started = await session.startDesigners(
      { instruction: input.instruction, lookIdeas: input.lookIdeas, concepts },
      ({ byKind }) => {
        const filed = DESIGNER_INPUTS.filter((kind) => byKind.has(kind));
        return (
          (filed.length > 0 ? startHere(session.inputs(filed, byKind)) : "") +
          skills
        );
      },
    );
    const runs: Started["runs"] = [];
    for (const outcome of started) {
      if ("error" in outcome)
        notStarted.push({ concept: outcome.concept, reason: outcome.error });
      else runs.push({ runId: outcome.runId, concept: outcome.concept });
    }
    if (runs.length === 0)
      throw new Refusal(
        "No designer was started: " +
          notStarted.map(({ reason }) => reason).join(" "),
      );
    return { runs, notStarted };
  },
);

// A writer writes or revises one document from every other filed document; the build plan alone is
// written from the design, and to the default stack unless the person asked otherwise.
const writer = starter(
  type({
    "+": "reject",
    workflow: "'writer'",
    kind: "'product_requirements' | 'build_plan'",
  }),
  Instructed,
  async ({ kind }, { instruction }, session) => {
    const { byKind, preferences } = await session.listed();
    const sources = [...byKind]
      .filter(
        ([filed]) =>
          filed !== "app" &&
          filed !== kind &&
          (filed !== "design" || kind === "build_plan"),
      )
      .map(([, ref]) => ref);
    const started = await session.deploy(
      "writer",
      session.options.workflows[WRITER_PACKAGES[kind]],
      preferences,
      "writer-" + kind,
      await writerTask(
        {
          kind,
          instruction:
            kind === "build_plan"
              ? instruction +
                "\n\nDefault stack unless the person asked otherwise: " +
                DEFAULT_STACK
              : instruction,
          sources,
          current: byKind.get(kind),
        },
        session.readSource,
      ),
    );
    return one(started);
  },
);

// Any document the coordinator names, written from every other filed document. The known kinds
// above keep their own writers for the fields and templates those carry.
const document = starter(
  type({ "+": "reject", workflow: "'writer-document'" }),
  type({ kind: "string", title: "string", instruction: "string" }),
  async (_start, { kind, title, instruction }, session) => {
    const { byKind, preferences } = await session.listed();
    const sources = [...byKind]
      .filter(([filed]) => filed !== "app" && filed !== kind)
      .map(([, ref]) => ref);
    const started = await session.deploy(
      "writer",
      session.options.workflows[DOCUMENT_WRITER_PACKAGE],
      preferences,
      "writer-" + kind,
      await writerTask(
        {
          kind,
          instruction: `Title: ${title}\n\n${instruction}`,
          sources,
          current: byKind.get(kind),
        },
        session.readSource,
      ),
    );
    return one(started);
  },
);

// The reviewer checks the document against the problem brief when the project has one.
const reviewer = starter(
  type({ "+": "reject", workflow: "'reviewer'" }),
  type({ kind: "string", instruction: "string" }),
  async (_start, { kind, instruction }, session) => {
    const { byKind, preferences } = await session.listed();
    session.required(byKind, kind);
    const started = await session.deploy(
      "reviewer",
      session.options.workflows.reviewer,
      preferences,
      "reviewer-" + kind,
      await writerTask(
        {
          kind: "engineering_review",
          instruction,
          sources: [...byKind]
            .filter(([filed]) => filed === "problem_brief" || filed === kind)
            .map(([, ref]) => ref),
        },
        session.readSource,
      ),
    );
    return one(started);
  },
);

/** The installed workflows a plugin action's start block may name, by that name. */
export const STARTERS: Readonly<Record<string, ReturnType<typeof starter>>> = {
  coder,
  designer,
  writer,
  "writer-document": document,
  reviewer,
};

/**
 * Starts a workflow action on its checked input with the starter its manifest names, its run's
 * assignment carrying values, the block of project values the action reads.
 */
export function startAction(
  action: WorkflowAction,
  input: unknown,
  session: ProjectSession,
  values: string,
) {
  const named = STARTERS[action.builder.start.workflow];
  if (!named)
    throw new Error(`${action.name} starts a workflow the hub does not have`);
  return named.run(
    action.builder.start,
    input,
    session.forAction({ plugin: action.plugin, action: action.action, values }),
    skillPacksIndex(action.packs),
  );
}
