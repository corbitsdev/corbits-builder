import { type } from "arktype";
import { lookOf } from "@corbits-builder/plugin";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Project,
  type Started,
} from "@corbits-builder/plugin-host/coordinator";
import { waitOrStop } from "@corbits-builder/plugin-host/text";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import manifest from "../package.json";
import {
  conceptAssignment,
  DESIGNER_INPUTS,
  designerBusy,
} from "./contract.ts";

const { design, actions } = manifest.builder;

// The project values that carry the person's brand: the ones a mockup's run is given.
const BRAND = actions.mockup.reads;

// A design concept is one designer's: the hub files that run's design as the concept's option.
const conceptBusy = (concept: string, runId: string) =>
  `the ${concept} designer in run ${runId} is still at work, and a concept is one designer's because its design is filed as that concept's option. ${waitOrStop(JSON.stringify(runId))} A new concept label starts alongside it.`;

const nothingStarted = (notStarted: Started["notStarted"]) =>
  new Refusal(
    "No designer was started: " +
      notStarted.map(({ reason }) => reason).join(" "),
  );

// With approvals handed over nobody compares concepts: the hub uses the one design filed.
const oneConceptOnly = (count: number) =>
  new Refusal(
    `No designer was started: approvals are handed over to Builder, so one design is made and used without asking the person, and this call named ${count} concepts. Call again with one concept.`,
  );

const NO_GUIDANCE =
  "Nothing tells the designer what to design: the project has no filed product requirements and no app, and this call gives no audience and screens. Supply one of these: start writer write-requirements and design once the requirements are filed; or, when the person wants a mockup without requirements, pass audience (who uses it and what for) and screens (each screen and what it is for), asking the person for what the conversation has not said.";

const noTheme = (labels: readonly string[]) =>
  `No theme for ${labels.join(", ")}: none of the designer's looks has that label, the project has none of the person's brand guidelines, fonts or colours saved, and this call does not set createTheme. Supply one of these: use one of the looks by its exact label (${design.looks.map(({ label }) => label).join(", ")}); save the person's brand on the project first, such as with designer pick-fonts or pick-colours; or, when the person asked for a look of their own or this is another pass on such a concept, call again with createTheme: true.`;

const saved = (value: unknown) =>
  value !== null && value !== undefined && value !== "";

const Input = type({
  instruction: "string",
  lookIdeas: "string",
  concepts: DesignConcept.array(),
  "createTheme?": "true",
  "audience?": "string",
  "screens?": "string[]",
});

/**
 * What a designer cannot start without, each with the ways to supply it: a theme for every concept,
 * from one of the looks, the person's brand saved on the project or a request to create one; and
 * guidance on what to design, from filed requirements, an existing app or the call's audience and
 * screens. Neither is a fact alone, so the start asks for them rather than the action's requires.
 */
async function lacking(input: typeof Input.infer, project: Project) {
  const { facts } = await project.state();
  const guided =
    facts.has("filed:product_requirements") ||
    facts.has("app_exists") ||
    (input.audience !== undefined && input.screens !== undefined);
  const branded =
    input.createTheme === true ||
    Object.values(await project.values(BRAND)).some(saved);
  const unthemed = branded
    ? []
    : input.concepts
        .filter(({ label }) => lookOf(design, label) === undefined)
        .map(({ label }) => label);
  return [
    ...(guided ? [] : [NO_GUIDANCE]),
    ...(unthemed.length === 0 ? [] : [noTheme(unthemed)]),
  ];
}

// One designer for each concept, from whatever documents the project has filed, once the call has a
// theme and guidance. A concept whose designer is still at work is refused at once; the others start.
export default defineStarter(
  type({ "+": "reject", workflow: "'designer'" }),
  Input,
  async ({ workflow }, input, project: Project, skills) => {
    const missing = await lacking(input, project);
    if (missing.length > 0)
      throw new Refusal(`No designer was started. ${missing.join("\n\n")}`);
    const { concepts } = input;
    if (concepts.length > 1 && !(await project.state()).asksApprovals)
      throw oneConceptOnly(concepts.length);
    const busy = new Map(
      (await project.working()).flatMap((run) =>
        run.role === "designer" && run.concept
          ? [[run.concept, run.runId]]
          : [],
      ),
    );
    const notStarted: Started["notStarted"] = [];
    for (const { label } of concepts) {
      const runId = busy.get(label);
      if (runId)
        notStarted.push({ concept: label, reason: conceptBusy(label, runId) });
    }
    const free = concepts.filter(({ label }) => !busy.has(label));
    if (free.length === 0) throw nothingStarted(notStarted);
    const started = await project.startConcepts({
      workflow,
      correlation: "designer",
      concepts: free,
      assignment: (filed, concept) =>
        (filed.startHere(DESIGNER_INPUTS, false) ?? "") +
        skills +
        conceptAssignment(concept, input),
      busy: designerBusy,
    });
    const runs: Started["runs"] = [];
    for (const outcome of started) {
      if ("error" in outcome)
        notStarted.push({ concept: outcome.concept, reason: outcome.error });
      else runs.push({ runId: outcome.runId, concept: outcome.concept });
    }
    if (runs.length === 0) throw nothingStarted(notStarted);
    return { runs, notStarted };
  },
);
