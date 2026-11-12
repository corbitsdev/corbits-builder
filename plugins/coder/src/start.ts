import { type } from "arktype";
import { defineStarter } from "@corbits-builder/plugin-host/catalog";
import {
  Refusal,
  type Project,
  type Working,
} from "@corbits-builder/plugin-host/coordinator";
import { waitOrStop } from "@corbits-builder/plugin-host/text";
import {
  APP_CHANGE_NOTE,
  CODER_INPUTS,
  coderTaskMessage,
  NO_DOCUMENTS_NOTE,
} from "./contract.ts";

// One coder works on the app at a time: the project has one app repository, and a second coder
// would start from the app without the first one's work and overwrite it when it saves. Without
// live, the other coder is still starting, from another execute in the same turn.
function coderBusy(live?: Working) {
  const other =
    live === undefined
      ? "Another coder is starting on the app from an execute call in this same turn"
      : `The coder in run ${live.runId} is ${live.state === "waiting" ? "between turns, just started or saving its last files after its report" : "still at work on the app"}`;
  const next =
    live === undefined
      ? `That call returns its run id. ${waitOrStop("its run id")}`
      : waitOrStop(JSON.stringify(live.runId));
  return new Refusal(
    `The coder was not started. ${other}, and one coder works on the app at a time because the project has one app repository: a second coder would start without that run's work and overwrite it. ${next} Giving each coder its own branch of the app, merged when it finishes, would lift this.`,
  );
}

// A change starts from the app as last saved; a first build's manifest requires that there is none.
// A coder still on the app refuses at once rather than wait for it. A project whose person lets
// packages install without asking gets the coder whose install_packages does not ask; a running
// coder keeps the definition it was deployed with.
export default defineStarter(
  type({
    "+": "reject",
    workflow: "'coder'",
    correlation: "string > 0",
    app: "'new' | 'existing'",
  }),
  type({ instruction: "string" }),
  async (
    { workflow, correlation, app },
    { instruction },
    project: Project,
    skills,
  ) => {
    const live = (await project.working()).find((run) => run.role === "coder");
    if (live) throw coderBusy(live);
    const { preferences } = await project.state();
    const { runId } = await project.startAlone({
      workflow:
        preferences["install_any_package"] === "yes"
          ? "coder-any-package"
          : workflow,
      correlation,
      // The filed documents a coder works from and the chosen design; with neither, the note
      // that the instruction is the whole assignment.
      assignment: (filed) =>
        (filed.startHere(CODER_INPUTS, true) ?? NO_DOCUMENTS_NOTE) +
        skills +
        (app === "existing" ? APP_CHANGE_NOTE : "") +
        coderTaskMessage(instruction),
      busy: coderBusy,
    });
    return { runs: [{ runId }], notStarted: [] };
  },
);
