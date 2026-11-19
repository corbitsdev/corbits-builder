import { type } from "arktype";
import {
  AppStarter,
  starterValues,
  StartRefusal,
  defineStarter,
  taskMessage,
  type StarterProject,
  type Working,
} from "@corbits-builder/plugin";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  NO_DOCUMENTS_NOTE,
  STARTER_NAMES,
  STARTERS,
} from "./contract.ts";

// One coder works on the code at a time: the project has one app repository, and a second coder
// would start from the code without the first one's work and overwrite it when it saves. Without
// live, the other coder is still starting, from another execute in the same turn.
function coderBusy(project: StarterProject, live?: Working) {
  const other =
    live === undefined
      ? "Another coder is starting on the project's code from an execute call in this same turn"
      : `The coder in run ${live.runId} is ${live.state === "waiting" ? "between turns, just started or saving its last files after its report" : "still at work on the code"}`;
  const next =
    live === undefined
      ? `That call returns its run id. ${project.heldBack("its run id")}`
      : project.heldBack(JSON.stringify(live.runId));
  return new StartRefusal(
    `The coder was not started. ${other}, and one coder works on the code at a time because the project has one repository for it: a second coder would start without that run's work and overwrite it. ${next} Giving each coder its own branch, merged when it finishes, would lift this.`,
  );
}

// The project values a first build saves for the starter it names, or for none.
function startedFrom(name: unknown) {
  if (name === undefined) return starterValues(null);
  const found = STARTER_NAMES.find((each) => each === name);
  if (found === undefined)
    throw new StartRefusal(
      `${String(name)}_not_a_starter: name one of ${STARTER_NAMES.join(", ")}, or none`,
    );
  return starterValues({
    name: found,
    starter: AppStarter.assert(STARTERS[found]),
  });
}

// A change starts from the code as last saved; a first build's manifest requires that there is
// none. A first build saves the starter it names, or that it names none, as the project's stack
// before the run is assigned; the hub writes that starter's files as the project's first code when
// the coder first asks for push access.
export default defineStarter(
  type({
    "+": "reject",
    workflow: "'coder'",
    correlation: "string > 0",
    app: "'new' | 'existing'",
  }),
  // The build action may also name a starter, which a change does not.
  type({ instruction: "string", "[string]": "unknown" }),
  async ({ correlation, app }, input, project, skills) => {
    const { runId } = await project.startAlone({
      workflow: "coder",
      correlation,
      // The filed documents a coder works from and the chosen design; with none, the note that the
      // instruction is the whole assignment.
      assignment: (filed) =>
        (filed.startHere(CODER_INPUTS, true) ?? NO_DOCUMENTS_NOTE) +
        skills +
        (app === "existing" ? APP_CHANGE_NOTE : "") +
        taskMessage(input.instruction),
      busy: (other) => coderBusy(project, other),
      keep:
        app === "new"
          ? () => ({ values: startedFrom(input["starter"]) })
          : undefined,
    });
    return { runs: [{ runId }], notStarted: [] };
  },
);
