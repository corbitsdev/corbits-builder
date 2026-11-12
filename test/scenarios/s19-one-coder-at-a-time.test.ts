import { expect } from "bun:test";
import { coderReports, coderWorks } from "./specialists.ts";
import {
  bound,
  call,
  calls,
  execute,
  keep,
  ok,
  refused,
  results,
  say,
  scenario,
  settled,
  turn,
  user,
} from "./runner.ts";

const firstReport = "The settings page is tidy.";
const sameTurnReport = "The change is in.";
const tidy = {
  instruction:
    "Tidy the settings page: align the labels and group the unit toggles.",
};
const bigger = {
  instruction:
    "Make the text bigger across the app, the body text most of all.",
};
const bold = {
  instruction:
    "Make every heading in the app bold, the city names most of all.",
};

scenario({
  name: "s19-one-coder-at-a-time",
  title:
    "a second coder while one works is refused, and two coder starts in one turn",
  start: "weather-app",
  // Which of two starts in one turn wins is a race, so either may start and the other is refused.
  expectChange:
    "two coder starts in one turn get a plain refusal for whichever loses the race to start; before that change, both could start.",
  coordinator: [
    turn(user("settings page"), execute("c_first", "coder", "change", tidy)),
    turn(
      results(keep(ok("c_first", "execute"), { first: "runs.0.runId" })),
      say("A coder is on it."),
    ),
    turn(user("text bigger"), execute("c_busy", "coder", "change", bigger)),
    turn(
      results(
        refused("c_busy", "execute", "one coder works on the app at a time"),
      ),
      say("One coder works at a time; I will start that next."),
    ),
    turn(
      user(firstReport),
      call("c_wait", "runs", {
        operation: "wait",
        runIds: [bound("first")],
        seconds: 60,
      }),
    ),
    turn(
      results(ok("c_wait", "runs")),
      calls(
        execute("c_same_turn_1", "coder", "change", bold),
        execute("c_same_turn_2", "coder", "change", bigger),
      ),
    ),
    turn(
      results(
        settled("c_same_turn_1", "execute"),
        settled("c_same_turn_2", "execute"),
      ),
      say("One coder started; the other change waits its turn."),
    ),
    turn(user(sameTurnReport), say("The change is in now.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderWorks({
        assignedWith: "settings page",
        seconds: 30,
        report: firstReport,
      }),
    },
    // Whichever same-turn start wins: both instructions end "most of all".
    "coder-same-turn": {
      role: "coder",
      turns: coderReports({
        assignedWith: "most of all",
        report: sameTurnReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Tidy the settings page.");
    await p.until("the first coder to start work", async () =>
      p.asked("coder") > 0 ? true : undefined,
    );
    await p.say("Also make the text bigger.");
    await p.heard("The change is in now.");
    p.note("the second start while the first works", p.resultOf("c_busy").text);
    p.note("runs wait on the first coder", p.resultOf("c_wait").text);
    p.note("the first of two starts in one turn", p.resultOf("c_same_turn_1"));
    p.note("the second of two starts in one turn", p.resultOf("c_same_turn_2"));
    const sameTurn = [p.resultOf("c_same_turn_1"), p.resultOf("c_same_turn_2")];
    const refusedOnes = sameTurn.filter(({ isError }) => isError);
    expect(refusedOnes).toHaveLength(1);
    expect(refusedOnes[0]!.text).toContain("in this same turn");
  },
});
