import { coderChecksStarter } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const report =
  "The coder started; check-app wants a README and a user manual first.";

scenario({
  name: "s12-build-fresh",
  title: "coder build on a fresh project with only an instruction",
  start: { fresh: "Just build me a to-do list app, nothing fancy." },
  expectChange:
    "coder build without documents has just landed; before it, this call was refused for want of filed requirements or a build plan.",
  coordinator: [
    turn(
      user("to-do list"),
      execute("c_build", "coder", "build", {
        instruction:
          "Build a to-do list web app: add, tick off and delete tasks, kept in the browser.",
      }),
    ),
    turn(
      results(ok("c_build", "execute", '"started":true')),
      say("A coder is building it."),
    ),
    turn(user(report), say("Your to-do app is built.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderChecksStarter({ assignedWith: "to-do list", report }),
    },
  },
  person: async (p) => {
    await p.heard("Your to-do app is built.");
    p.note("coder build returned", p.resultOf("c_build").text);
    p.note("the coder's assignment", p.assignment("coder"));
  },
});
