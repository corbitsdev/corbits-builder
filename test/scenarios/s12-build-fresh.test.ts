import { expect } from "bun:test";
import {
  execute,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

scenario({
  name: "s12-build-fresh",
  title:
    "coder build on a fresh project with only an instruction is refused for want of documents",
  start: { fresh: "Just build me a to-do list app, nothing fancy." },
  coordinator: [
    turn(
      user("to-do list"),
      execute("c_build", "coder", "build", {
        instruction:
          "Build a to-do list web app: add, tick off and delete tasks, kept in the browser.",
      }),
    ),
    turn(
      results(refused("c_build", "execute", "product requirements")),
      say("The app needs its requirements written first."),
    ),
  ],
  person: async (p) => {
    await p.heard("The app needs its requirements written first.");
    const refusal = p.resultOf("c_build").text;
    p.note("coder build returned", refusal);
    expect(refusal).toContain("build plan");
  },
});
