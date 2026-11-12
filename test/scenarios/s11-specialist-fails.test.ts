import { expect } from "bun:test";
import {
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Turn,
} from "./runner.ts";
import type { AgentRole } from "../e2e/support/recorded-model.ts";

const gaveUp =
  "I could not find enough about the competitors to write anything.";

// A writer's reply before its document is filed is held, with a note in the same conversation;
// after three held replies the fourth ends the run as not finished.
const givesUp: { role: AgentRole; turns: Turn[] } = {
  role: "writer",
  turns: [
    turn(user("competitor_analysis"), say(gaveUp)),
    ...Array.from({ length: 3 }, () =>
      turn(user("Builder held your reply"), say(gaveUp)),
    ),
  ],
};

scenario({
  name: "s11-specialist-fails",
  title:
    "a writer that ends without filing anything: what the coordinator is told",
  start: { fresh: "Write me a competitor analysis of the dog-walking apps." },
  coordinator: [
    turn(
      user("competitor analysis"),
      execute("c_write", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: "Compare the dog-walking apps people near us use.",
      }),
    ),
    turn(results(ok("c_write", "execute")), say("A writer is on it.")),
    turn(
      user("Hub note, not from the person: The writer's write stopped"),
      say("The writer stopped without a document."),
    ),
  ],
  specialists: { writer: givesUp },
  person: async (p) => {
    await p.heard("The writer stopped without a document.");
    const turns = await p.hub.client.conversationEvents(
      p.tenantId,
      p.projectId,
    );
    p.note("what the person saw", turns.turns?.slice(-4));
    const { artifacts, failed } = await p.hub.client.projectArtifacts(
      p.tenantId,
      p.projectId,
    );
    p.note("failed runs the hub lists", failed);
    p.note("what the coordinator was told", p.messages("coordinator").at(-1));
    expect(p.messages("coordinator").at(-1)).toContain("not_finished");
    expect(artifacts.some((item) => item.kind === "competitor_analysis")).toBe(
      false,
    );
  },
});
