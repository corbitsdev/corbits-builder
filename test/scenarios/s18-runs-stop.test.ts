import { expect } from "bun:test";
import { CODER_TOOLS, coderReports } from "./specialists.ts";
import {
  bound,
  call,
  execute,
  keep,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const secondReport = "The text is bigger.";

scenario({
  name: "s18-runs-stop",
  title:
    "runs stop on a coder that keeps working: what the coordinator and the person are told, and a new coder starts",
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
      user("text bigger"),
      execute("c_again", "coder", "change", {
        instruction:
          "Make the text bigger across the app, the body text most of all.",
      }),
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
    await Bun.sleep(3_000);
    await p.say("Stop the coder, I changed my mind.");
    await p.heard("I stopped the coder.");
    p.note("runs list before the stop", p.resultOf("c_list").text);
    p.note("runs stop returned", p.resultOf("c_stop").text);
    const stopped = await p.until("the coder run to end", async () => {
      const listed = await p.call("GET", `${p.path}/runs`);
      return JSON.stringify(listed.body).includes('"cancelled"')
        ? listed.body
        : undefined;
    });
    p.note("the hub's runs after the stop", stopped);
    await p.heard("The coder's stop is confirmed.");
    const seen = await p.hub.client.conversationEvents(p.tenantId, p.projectId);
    p.note("what the person's conversation shows", seen.turns?.slice(-4));
    await p.say("Now make the text bigger.");
    await p.heard("The text is bigger now.");
    p.note("every message the coordinator received", p.messages("coordinator"));
    expect(p.resultOf("c_stop").text).toContain('"stopped"');
    expect(JSON.stringify(seen.turns)).toContain(
      "Hub note, not from the person: The coder's change was stopped.",
    );
    expect(p.resultOf("c_again").isError).toBe(false);
  },
});
