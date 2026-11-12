import { type, type Type } from "arktype";
import type { WorkflowAction } from "@corbits-builder/plugin-host/catalog";
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
  ) => Promise<unknown>,
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

// The filed documents a coder works from, and the chosen design when there is one.
function coderDocuments(
  session: ProjectSession,
  byKind: ProjectListing["byKind"],
) {
  const kinds = CODER_INPUTS.filter((kind) => byKind.has(kind));
  const design = byKind.get("design")?.version;
  if (kinds.length === 0 && design === undefined) return "";
  return startHere(session.inputs(kinds, byKind), design);
}

// A first build refuses a project that has an app; a change starts from the app as last saved.
const coder = starter(
  type({
    "+": "reject",
    workflow: "'coder'",
    correlation: "string > 0",
    app: "'new' | 'existing'",
  }),
  Instructed,
  ({ correlation, app }, { instruction }, session, skills) =>
    session.startCoder(correlation, ({ byKind }) => {
      if (app === "existing")
        return (
          coderDocuments(session, byKind) +
          skills +
          APP_CHANGE_NOTE +
          coderTaskMessage(instruction)
        );
      if (byKind.has("app")) throw new Refusal(APP_ALREADY_EXISTS);
      return (
        coderDocuments(session, byKind) + skills + coderTaskMessage(instruction)
      );
    }),
);

const designer = starter(
  type({ "+": "reject", workflow: "'designer'" }),
  type({
    instruction: "string",
    lookIdeas: "string",
    concepts: DesignConcept.array(),
  }),
  (_start, input, session, skills) =>
    session.startDesigners(input, ({ byKind }) => {
      const filed = DESIGNER_INPUTS.filter((kind) => byKind.has(kind));
      return (
        (filed.length > 0 ? startHere(session.inputs(filed, byKind)) : "") +
        skills
      );
    }),
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
    return session.deploy(
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
    return session.deploy(
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
  },
);

// The reviewer checks the document against the problem brief when the project has one.
const reviewer = starter(
  type({ "+": "reject", workflow: "'reviewer'" }),
  type({ kind: "string", instruction: "string" }),
  async (_start, { kind, instruction }, session) => {
    const { byKind, preferences } = await session.listed();
    session.required(byKind, kind);
    return session.deploy(
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
    session.withValues(values),
    skillPacksIndex(action.packs),
  );
}
