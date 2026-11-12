import { expect } from "bun:test";
import {
  call,
  execute,
  failsWith,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Turn,
} from "./runner.ts";
import type { AgentRole } from "../e2e/support/recorded-model.ts";

// The model behind the writer is down: every attempt at its first turn answers HTTP 500.
const down: { role: AgentRole; turns: Turn[] } = {
  role: "writer",
  turns: [
    failsWith(user("competitor_analysis"), 500, "The model server failed.", [
      "write_artifact",
    ]),
  ],
};

scenario({
  name: "s24-model-error",
  title:
    "a writer whose model answers HTTP 500: what the coordinator, the person and runs list are told",
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
    turn(user(), call("c_list", "runs", { operation: "list" })),
    turn(results(ok("c_list", "runs")), say("The writer could not work.")),
  ],
  specialists: {
    // The first attempt and each retry is a request the model has not seen, so each is a run of its own.
    "writer-1": down,
    "writer-2": down,
    "writer-3": down,
    "writer-4": down,
  },
  person: async (p) => {
    await p.heard("The writer could not work.");
    p.note("what the coordinator was told", p.messages("coordinator").at(-1));
    p.note("runs list", p.resultOf("c_list").text);
    const seen = await p.hub.client.conversationEvents(p.tenantId, p.projectId);
    p.note("what the person's conversation shows", seen.turns?.slice(-4));
    const { failed } = await p.hub.client.projectArtifacts(
      p.tenantId,
      p.projectId,
    );
    p.note("failed runs the hub lists", failed);
    expect(p.resultOf("c_list").text).toContain('"status":"failed"');
    expect(p.resultOf("c_list").text).toContain('"error"');
  },
});
