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

const build = {
  starter: "web-app",
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
      call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
    ),
    turn(
      results(ok("c_follow", "plan", "write-requirements")),
      execute("c_build_on_plan", "coder", "build", build),
    ),
    turn(
      results(refused("c_build_on_plan", "execute")),
      call("c_leave", "plan", { operation: "set", steps: [] }),
    ),
    turn(
      results(ok("c_leave", "plan")),
      execute("c_build_off_plan", "coder", "build", build),
    ),
    // Off the plan a first build still needs its documents filed.
    turn(
      results(
        refused(
          "c_build_off_plan",
          "execute",
          "The project does not have what it needs yet.",
        ),
      ),
      say("The build needs the requirements and a build plan first."),
    ),
  ],
  person: async (p) => {
    await p.heard("The build needs the requirements and a build plan first.");
    for (const id of [
      "c_follow",
      "c_build_on_plan",
      "c_leave",
      "c_build_off_plan",
    ])
      p.note(`${id} returned`, p.resultOf(id).text);
  },
});
