import { expect } from "bun:test";
import {
  call,
  execute,
  ok,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const report = "The competitor analysis is filed.";
const corrected = {
  kind: "competitor_analysis",
  title: "Competitor analysis",
  instruction: "Compare the dog-walking apps people near us use.",
};

scenario({
  name: "s02-bad-input-then-recovery",
  title:
    "an unknown plugin, an unknown action and a writer write with a missing field and a wrong kind are each refused with what exists or what to fix, and the corrected call starts",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_plugin", "painter", "paint", { instruction: "A logo." }),
    ),
    turn(
      results(refused("c_plugin", "execute")),
      execute("c_action", "designer", "paint", { instruction: "A logo." }),
    ),
    turn(
      results(refused("c_action", "execute")),
      execute("c_bad", "writer", "write", {
        kind: "Competitor Analysis",
        title: "Competitor analysis",
      }),
    ),
    turn(
      results(refused("c_bad", "execute")),
      execute("c_good", "writer", "write", corrected),
    ),
    turn(results(ok("c_good", "execute")), say("A writer is on it.")),
    turn(user(report), say("Your competitor analysis is ready.")),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: [
        turn(
          user("competitor_analysis"),
          call("w_file", "write_artifact", {
            kind: "competitor_analysis",
            title: "Competitor analysis",
            content: "## In short\nThree apps serve our area.",
          }),
        ),
        turn(results(ok("w_file", "write_artifact")), say(report)),
      ],
    },
  },
  person: async (p) => {
    await p.heard("Your competitor analysis is ready.");
    // Each refusal names what was wrong and what exists instead, so the coordinator can recover.
    const plugin = p.resultOf("c_plugin").text;
    const action = p.resultOf("c_action").text;
    const fields = p.resultOf("c_bad").text;
    p.note("unknown plugin", plugin);
    p.note("unknown action", action);
    p.note("missing field and wrong kind", fields);
    expect(plugin).toContain("painter");
    expect(plugin).toContain("designer mockup");
    // A ready-made plan is taken up with the plan tool, so execute does not offer it.
    expect(plugin).not.toContain("build-web-app");
    expect(action).toContain("paint");
    expect(action).toContain("mockup");
    expect(action).toContain("pick-fonts");
    expect(fields).toContain("instruction");
    expect(fields).toContain("kind");
    expect(fields).toContain("competitor_analysis");
    await p.filed("competitor_analysis", 1);
  },
});
