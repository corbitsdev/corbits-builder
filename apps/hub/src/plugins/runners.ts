import type buildAppInput from "@corbits-builder/build-app";
import type changeAppInput from "@corbits-builder/change-app";
import type designAppInput from "@corbits-builder/design-app";
import type reviewDocumentInput from "@corbits-builder/review-document";
import type writeBuildPlanInput from "@corbits-builder/write-build-plan";
import type writeRequirementsInput from "@corbits-builder/write-requirements";
import { coderTaskMessage } from "@corbits-builder/coder/contract";
import { WRITER_PACKAGES } from "@corbits-builder/schemas/installed-workflows";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  DESIGNER_INPUTS,
  startHere,
} from "../config/inputs.ts";
import { DEFAULT_STACK } from "../config/packages.ts";
import { APP_ALREADY_EXISTS } from "../config/execute.ts";
import {
  Refusal,
  type ProjectListing,
  type ProjectSession,
} from "../projects/project-session.ts";
import { writerTask } from "../workflows/writer-task.ts";

// Turns a workflow plugin's checked input into the start of its specialist's run. What the plugin
// requires is checked before; a runner refuses only what it finds when it starts.
export type Runner<In> = (
  input: In,
  session: ProjectSession,
) => Promise<unknown>;

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

export const buildApp: Runner<(typeof buildAppInput.input)["infer"]> = (
  { instruction },
  session,
) =>
  session.startCoder("coder", ({ byKind }) => {
    if (byKind.has("app")) throw new Refusal(APP_ALREADY_EXISTS);
    return coderDocuments(session, byKind) + coderTaskMessage(instruction);
  });

export const changeApp: Runner<(typeof changeAppInput.input)["infer"]> = (
  { instruction },
  session,
) =>
  session.startCoder(
    "coder-change",
    ({ byKind }) =>
      coderDocuments(session, byKind) +
      APP_CHANGE_NOTE +
      coderTaskMessage(instruction),
  );

export const designApp: Runner<(typeof designAppInput.input)["infer"]> = (
  input,
  session,
) =>
  session.startDesigners(input, ({ byKind }) => {
    const filed = DESIGNER_INPUTS.filter((kind) => byKind.has(kind));
    return filed.length > 0 ? startHere(session.inputs(filed, byKind)) : "";
  });

// A writer writes or revises one document from every other filed document; the build plan alone is
// written from the design.
async function writeDocument(
  kind: "product_requirements" | "build_plan",
  instruction: string,
  session: ProjectSession,
) {
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
      { kind, instruction, sources, current: byKind.get(kind) },
      session.readSource,
    ),
  );
}

export const writeRequirements: Runner<
  (typeof writeRequirementsInput.input)["infer"]
> = ({ instruction }, session) =>
  writeDocument("product_requirements", instruction, session);

export const writeBuildPlan: Runner<
  (typeof writeBuildPlanInput.input)["infer"]
> = ({ instruction }, session) =>
  writeDocument(
    "build_plan",
    instruction +
      "\n\nDefault stack unless the person asked otherwise: " +
      DEFAULT_STACK,
    session,
  );

// The reviewer checks the document against the problem brief when the project has one.
export const reviewDocument: Runner<
  (typeof reviewDocumentInput.input)["infer"]
> = async ({ kind, instruction }, session) => {
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
};
