import { type } from "arktype";
import {
  StartRefusal,
  defineStarter,
  taskMessage,
  type StarterProject,
  type Working,
} from "@corbits-builder/plugin";

// The action that starts each agent, as the coordinator names it.
const ACTIONS = {
  "digitalocean-create": "digitalocean create",
  digitalocean: "digitalocean publish",
  "digitalocean-remove": "digitalocean remove",
} as const;

// Create, publish and remove each run a separate agent, and all of them play the plugin's single
// role, so only one works on the server at a time. A removal never runs beside a create that is
// still making the server, and a publish never runs beside a removal.
function busy(action: string, project: StarterProject, live?: Working) {
  const other =
    live === undefined
      ? "Another DigitalOcean run is starting from an execute call in this same turn"
      : `The DigitalOcean run ${live.runId} is still at work on the project's server`;
  const next =
    live === undefined
      ? `That call returns its run id. ${project.heldBack("its run id")}`
      : project.heldBack(JSON.stringify(live.runId));
  return new StartRefusal(
    `${action} was not started. ${other}, and one DigitalOcean run works on the server at a time, so it is never made, published to and deleted at once. ${next}`,
  );
}

export default defineStarter(
  type({
    "+": "reject",
    workflow: "'digitalocean-create' | 'digitalocean' | 'digitalocean-remove'",
  }),
  type({ instruction: "string", "[string]": "unknown" }),
  async ({ workflow }, { instruction }, project, skills) => {
    const { runId } = await project.startAlone({
      workflow,
      correlation: workflow,
      assignment: () => `${taskMessage(instruction)}\n\n${skills.trim()}`,
      busy: (live) => busy(ACTIONS[workflow], project, live),
    });
    return { runs: [{ runId }], notStarted: [] };
  },
);
