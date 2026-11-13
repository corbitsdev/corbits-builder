import { expect } from "bun:test";
import { type } from "arktype";
import { ProjectRuns } from "@corbits-builder/schemas/artifact";
import { CODER_TOOLS, coderReports } from "./specialists.ts";
import {
  bound,
  call,
  execute,
  keep,
  ok,
  refused,
  results,
  say,
  scenario,
  startedRun,
  turn,
  user,
} from "./runner.ts";

const secondReport = "The text is bigger.";
const bigger = {
  instruction:
    "Make the text bigger across the app, the body text most of all.",
};

scenario({
  name: "s18-runs-stop",
  title:
    "a second coder is refused while one works; runs stop ends the working coder, the coordinator is told, and a new coder then starts",
  start: "weather-app",
  coordinator: [
    turn(
      user("settings page"),
      execute("c_code", "coder", "change", {
        instruction:
          "Tidy the settings page: align the labels and group the unit toggles.",
      }),
    ),
    turn(
      results(keep(ok("c_code", "execute"), { coder: "runs.0.runId" })),
      say("A coder is on it."),
    ),
    turn(
      user("Also make the text bigger"),
      execute("c_busy", "coder", "change", bigger),
    ),
    turn(
      results(
        refused("c_busy", "execute", "one coder works on the code at a time"),
      ),
      say("One coder works at a time; I will start that next."),
    ),
    turn(user("Stop the coder"), call("c_list", "runs", { operation: "list" })),
    turn(
      results(ok("c_list", "runs")),
      call("c_stop", "runs", { operation: "stop", runIds: [bound("coder")] }),
    ),
    turn(results(ok("c_stop", "runs")), say("I stopped the coder.")),
    turn(
      user("Hub note, not from the person: The coder's change was stopped."),
      say("The coder's stop is confirmed."),
    ),
    turn(
      user("Now make the text bigger"),
      execute("c_again", "coder", "change", bigger),
    ),
    turn(results(ok("c_again", "execute")), say("A new coder is on it.")),
    turn(user(secondReport), say("The text is bigger now.")),
  ],
  specialists: {
    // Sleeps far longer than the scenario waits; only the stop ends it.
    coder: {
      role: "coder",
      turns: [
        turn(
          user("settings page"),
          call("coder_work", "run_shell", {
            command: "sleep 170",
            timeout: 180_000,
          }),
          CODER_TOOLS,
        ),
      ],
    },
    "coder-2": {
      role: "coder",
      turns: coderReports({
        assignedWith: "text bigger",
        report: secondReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Tidy the settings page.");
    await p.until("the coder to start its shell", async () =>
      p.asked("coder") > 0 ? true : undefined,
    );
    await p.say("Also make the text bigger.");
    await p.heard("One coder works at a time");
    p.note("the second start while the first works", p.resultOf("c_busy").text);
    await p.say("Stop the coder, I changed my mind.");
    await p.heard("I stopped the coder.");
    const first = startedRun(p.resultOf("c_code").text);
    p.note("runs list before the stop", p.resultOf("c_list").text);
    const stop = type({ stopped: "string[]", "+": "ignore" }).assert(
      JSON.parse(p.resultOf("c_stop").text),
    );
    expect(stop.stopped).toEqual([first]);
    const status = await p.until("the coder run to end", async () => {
      const read = await p.call("GET", `${p.path}/runs`);
      const run = ProjectRuns.assert(read.body).runs.find(
        ({ runId }) => runId === first,
      );
      return run?.status === "running" || run?.status === "deployed"
        ? undefined
        : run?.status;
    });
    expect(status).toBe("cancelled");
    await p.heard("The coder's stop is confirmed.");
    await p.say("Now make the text bigger.");
    await p.heard("The text is bigger now.");
    expect(p.resultOf("c_again").isError).toBe(false);
  },
});
