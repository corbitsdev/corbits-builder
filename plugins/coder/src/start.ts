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
  DEFAULT_STARTER,
  isStarterName,
  NO_DOCUMENTS_NOTE,
  STARTERS,
} from "./contract.ts";

// One coder works on the code at a time: the project has one app repository, and a second coder
// would start from the code without the first one's work and overwrite it when it saves. Without
// live, the other coder is still starting, from another execute in the same turn.
function coderBusy(live?: Working) {
  const other =
    live === undefined
      ? "Another coder is starting on the project's code from an execute call in this same turn"
      : `The coder in run ${live.runId} is ${live.state === "waiting" ? "between turns, just started or saving its last files after its report" : "still at work on the code"}`;
  const next =
    live === undefined
      ? `That call returns its run id. ${waitOrStop("its run id")}`
      : waitOrStop(JSON.stringify(live.runId));
  return new Refusal(
    `The coder was not started. ${other}, and one coder works on the code at a time because the project has one repository for it: a second coder would start without that run's work and overwrite it. ${next} Giving each coder its own branch, merged when it finishes, would lift this.`,
  );
}

// What the run starts from: a first build's chosen starter, which its workspace is seeded from and
// records as stack.starter; a change, the starter the project's code was built from.
async function starterOf(
  app: "new" | "existing",
  input: Readonly<Record<string, unknown>>,
  project: Project,
) {
  const chosen =
    app === "new"
      ? input["starter"]
      : (await project.values(["stack.starter"]))["stack.starter"];
  return isStarterName(chosen) ? chosen : DEFAULT_STARTER;
}

// A change starts from the code as last saved; a first build's manifest requires that there is
// none. A coder still on the code refuses at once rather than wait for it. Each starter has its own
// coder package, whose prompt, tools and finish check fit what it builds; a project whose person
// lets packages install without asking gets that package's coder whose install_packages does not
// ask. A running coder keeps the definition it was deployed with.
export default defineStarter(
  type({
    "+": "reject",
    workflow: "'coder'",
    correlation: "string > 0",
    app: "'new' | 'existing'",
  }),
  // The build action also takes the starter, which a change does not.
  type({ instruction: "string", "[string]": "unknown" }),
  async ({ correlation, app }, input, project: Project, skills) => {
    const live = (await project.working()).find((run) => run.role === "coder");
    if (live) throw coderBusy(live);
    const { preferences } = await project.state();
    const starter = STARTERS[await starterOf(app, input, project)];
    const { runId } = await project.startAlone({
      workflow:
        preferences["install_any_package"] === "yes"
          ? `${starter.package}-any-package`
          : starter.package,
      correlation,
      // The filed documents a coder works from and, for a web app, the chosen design; with none,
      // the note that the instruction is the whole assignment.
      assignment: (filed) =>
        (filed.startHere(CODER_INPUTS, starter.serves) ?? NO_DOCUMENTS_NOTE) +
        skills +
        (app === "existing" ? APP_CHANGE_NOTE : "") +
        coderTaskMessage(input.instruction),
      busy: coderBusy,
    });
    return { runs: [{ runId }], notStarted: [] };
  },
);
