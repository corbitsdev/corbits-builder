import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Project,
  type Started,
} from "@corbits-builder/plugin-host/coordinator";
import { waitOrStop } from "@corbits-builder/plugin-host/text";
import { DesignConcept } from "@corbits-builder/schemas/artifact";
import {
  conceptAssignment,
  DESIGNER_INPUTS,
  designerBusy,
} from "./contract.ts";

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

// One designer for each concept, from whatever documents the project has filed. A concept whose
// designer is still at work is refused at once; the others start.
export default defineStarter(
  type({ "+": "reject", workflow: "'designer'" }),
  type({
    instruction: "string",
    lookIdeas: "string",
    concepts: DesignConcept.array(),
  }),
  async (
    { workflow },
    { instruction, lookIdeas, concepts },
    project: Project,
    skills,
  ) => {
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
        conceptAssignment(concept, lookIdeas, instruction),
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
