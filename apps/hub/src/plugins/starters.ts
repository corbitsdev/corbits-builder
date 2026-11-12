import { type } from "arktype";
import {
  defineStarter,
  type Starter,
  type WorkflowAction,
} from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Started,
} from "@corbits-builder/plugin-host/coordinator";
import { waitOrStop } from "@corbits-builder/plugin-host/text";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import {
  DOCUMENT_WRITER_PACKAGE,
  WRITER_PACKAGES,
} from "@corbits-builder/schemas/installed-workflows";
import { DESIGNER_INPUTS, startHere } from "../config/inputs.ts";
import { DEFAULT_STACK } from "../config/packages.ts";
import type { ProjectSession } from "../projects/project-session.ts";
import { writerTask } from "../workflows/writer-task.ts";

// A design concept is one designer's: the hub files that run's design as the concept's option.
const conceptBusy = (concept: string, runId: string) =>
  `the ${concept} designer in run ${runId} is still at work, and a concept is one designer's because its design is filed as that concept's option. ${waitOrStop(JSON.stringify(runId))} A new concept label starts alongside it.`;

// A started run of one specialist.
const one = ({ runId }: { runId: string }): Started => ({
  runs: [{ runId }],
  notStarted: [],
});

const Instructed = type({ instruction: "string" });

const designer = defineStarter(
  type({ "+": "reject", workflow: "'designer'" }),
  type({
    instruction: "string",
    lookIdeas: "string",
    concepts: DesignConcept.array(),
  }),
  async (_start, input, session: ProjectSession, skills) => {
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
const writer = defineStarter(
  type({
    "+": "reject",
    workflow: "'writer'",
    kind: "'product_requirements' | 'build_plan'",
  }),
  Instructed,
  async ({ kind }, { instruction }, session: ProjectSession) => {
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
const document = defineStarter(
  type({ "+": "reject", workflow: "'writer-document'" }),
  type({ kind: "string", title: "string", instruction: "string" }),
  async (_start, { kind, title, instruction }, session: ProjectSession) => {
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
const reviewer = defineStarter(
  type({ "+": "reject", workflow: "'reviewer'" }),
  type({ kind: "string", instruction: "string" }),
  async (_start, { kind, instruction }, session: ProjectSession) => {
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

/** The installed workflows the hub starts for a plugin action's start block, by the name it gives. */
export const STARTERS: Readonly<
  Record<
    string,
    Starter & {
      run(
        start: unknown,
        input: unknown,
        session: ProjectSession,
        skills: string,
      ): Promise<Started>;
    }
  >
> = {
  designer,
  writer,
  "writer-document": document,
  reviewer,
};

/**
 * Starts a workflow action on its checked input with the hub's starter its manifest names, in the
 * session for that action.
 */
export function startAction(
  action: WorkflowAction,
  input: unknown,
  session: ProjectSession,
  skills: string,
) {
  const named = STARTERS[action.builder.start.workflow];
  if (!named)
    throw new Error(`${action.name} starts a workflow the hub does not have`);
  return named.run(action.builder.start, input, session, skills);
}
