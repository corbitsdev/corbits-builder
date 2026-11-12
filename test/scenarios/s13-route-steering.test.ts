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
  name: "s13-route-steering",
  title:
    "on build-web-app, coder build before a design is chosen is steered, then the route is left",
  start: { fresh: "I want an app for booking dog walks. Build it now." },
  expectChange:
    "routes are to advise instead of refusing; then c_build_on_route starts, or returns its advice as a result that is not an error.",
  coordinator: [
    turn(user("dog walks"), execute("c_route", "build-web-app", undefined, {})),
    turn(
      results(ok("c_route", "execute", "write-requirements")),
      execute("c_build_on_route", "coder", "build", build),
    ),
    turn(
      results(refused("c_build_on_route", "execute")),
      execute("c_leave", "build-web-app", undefined, { leave: true }),
    ),
    turn(
      results(ok("c_leave", "execute")),
      execute("c_build_off_route", "coder", "build", build),
    ),
    turn(
      results(ok("c_build_off_route", "execute", '"started":true')),
      say("A coder is building it."),
    ),
    turn(user(report), say("Your app is built.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderChecksStarter({ assignedWith: "dog-walking", report }),
    },
  },
  person: async (p) => {
    await p.heard("Your app is built.");
    for (const id of [
      "c_route",
      "c_build_on_route",
      "c_leave",
      "c_build_off_route",
    ])
      p.note(`${id} returned`, p.resultOf(id).text);
  },
});
