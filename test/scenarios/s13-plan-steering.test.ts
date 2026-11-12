import { coderChecksStarter } from "./specialists.ts";
import {
  execute,
  ok,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const report =
  "The coder started; check-app wants a README and a user manual first.";
const build = {
  instruction:
    "Build the dog-walking booking app now, as the person described.",
};

scenario({
  name: "s13-plan-steering",
  title:
    "on build-web-app, coder build before a design is chosen is steered, then the plan is left",
  start: { fresh: "I want an app for booking dog walks. Build it now." },
  expectChange:
    "ready-made plans are to advise instead of refusing; then c_build_on_plan starts, or returns its advice as a result that is not an error.",
  coordinator: [
    turn(
      user("dog walks"),
      execute("c_follow", "build-web-app", undefined, {}),
    ),
    turn(
      results(ok("c_follow", "execute", "write-requirements")),
      execute("c_build_on_plan", "coder", "build", build),
    ),
    turn(
      results(refused("c_build_on_plan", "execute")),
      execute("c_leave", "build-web-app", undefined, { leave: true }),
    ),
    turn(
      results(ok("c_leave", "execute")),
      execute("c_build_off_plan", "coder", "build", build),
    ),
    turn(
      results(ok("c_build_off_plan", "execute", '"started":true')),
      say("A coder is building it."),
    ),
    turn(
      user(
        "Hub note, not from the person: The coder's build stopped before finishing.",
      ),
      say("The coder could not finish the build."),
    ),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderChecksStarter({ assignedWith: "dog-walking", report }),
    },
  },
  person: async (p) => {
    await p.heard("The coder could not finish the build.");
    for (const id of [
      "c_follow",
      "c_build_on_plan",
      "c_leave",
      "c_build_off_plan",
    ])
      p.note(`${id} returned`, p.resultOf(id).text);
  },
});
