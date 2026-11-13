import { expect } from "bun:test";
import { ProjectRuns } from "@corbits-builder/schemas/artifact";
import {
  call,
  execute,
  failsWith,
  ok,
  results,
  say,
  scenario,
  startedRun,
  turn,
  user,
  type Turn,
} from "./runner.ts";
import type { AgentRole } from "../e2e/support/recorded-model.ts";

const gaveUp =
  "I could not find enough about the competitors to write anything.";
const stopped = "Hub note, not from the person: The writer's write stopped";
const prices = "List what each dog-walking app charges for a walk.";

// A writer's reply before its document is filed is held, with a note in the same conversation;
// after three held replies the fourth ends the run as not finished.
const givesUp: { role: AgentRole; turns: Turn[] } = {
  role: "writer",
  turns: [
    turn(user("Compare the dog-walking apps"), say(gaveUp)),
    ...Array.from({ length: 3 }, () =>
      turn(user("Builder held your reply"), say(gaveUp)),
    ),
  ],
};

// The model behind the next writer is down: every attempt at its first turn answers HTTP 500.
const down: { role: AgentRole; turns: Turn[] } = {
  role: "writer",
  turns: [
    failsWith(user(prices), 500, "The model server failed.", [
      "write_artifact",
    ]),
  ],
};

scenario({
  name: "s11-specialist-fails",
  title:
    "a writer that ends without filing anything, and one whose model answers HTTP 500: the coordinator is told each ended, and the second is listed as failed",
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
      user(stopped),
      execute("c_prices", "writer", "write", {
        kind: "competitor_analysis",
        title: "Competitor analysis",
        instruction: prices,
      }),
    ),
    turn(results(ok("c_prices", "execute")), say("Another writer is on it.")),
    turn(user(stopped), call("c_list", "runs", { operation: "list" })),
    turn(results(ok("c_list", "runs")), say("The writer could not work.")),
  ],
  specialists: {
    writer: givesUp,
    // The first attempt and each retry is a request the model has not seen, so each is a run of its own.
    "writer-down-1": down,
    "writer-down-2": down,
    "writer-down-3": down,
    "writer-down-4": down,
  },
  person: async (p) => {
    await p.heard("The writer could not work.");
    const told = p.messages("coordinator").filter((m) => m.includes(stopped));
    p.note("what the coordinator was told", told);
    // The writer that gave up ended as not finished, and the coordinator was told so.
    expect(told.some((message) => message.includes("not_finished"))).toBe(true);
    const { runs } = ProjectRuns.assert(JSON.parse(p.resultOf("c_list").text));
    p.note("runs list", runs);
    // The writer whose model failed is listed as failed, with why.
    const down = runs.find(
      ({ runId }) => runId === startedRun(p.resultOf("c_prices").text),
    );
    expect(down?.status).toBe("failed");
    expect(down?.error).toBeDefined();
    const { artifacts } = await p.hub.client.projectArtifacts(
      p.tenantId,
      p.projectId,
    );
    expect(artifacts.some((item) => item.kind === "competitor_analysis")).toBe(
      false,
    );
  },
});
