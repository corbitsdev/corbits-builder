import { expect } from "bun:test";
import { coderWorks, writerFiles } from "./specialists.ts";
import {
  bound,
  call,
  calls,
  execute,
  keep,
  ok,
  results,
  say,
  scenario,
  startedRun,
  turn,
  user,
} from "./runner.ts";

const writerReport = "The security review is filed.";
const coderReport = "The settings page is tidy.";

scenario({
  name: "s17-runs-wait",
  title:
    "runs wait on a writer and a coder returns when the first ends, and its report still arrives as a message",
  start: "weather-app",
  coordinator: [
    turn(
      user("security review"),
      calls(
        execute("c_write", "writer", "write", {
          kind: "security_review",
          title: "Security review",
          instruction: "Review how the app handles the cities people save.",
        }),
        execute("c_code", "coder", "change", {
          instruction:
            "Tidy the settings page: align the labels and group the unit toggles.",
        }),
      ),
    ),
    turn(
      results(
        keep(ok("c_write", "execute"), { writer: "runs.0.runId" }),
        keep(ok("c_code", "execute"), { coder: "runs.0.runId" }),
      ),
      call("c_wait", "runs", {
        operation: "wait",
        runIds: [bound("writer"), bound("coder")],
        seconds: 60,
      }),
    ),
    turn(results(ok("c_wait", "runs")), say("The writer ended first.")),
    turn(user(writerReport), say("The security review is in.")),
    turn(user(coderReport), say("The settings page is tidy too.")),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "security_review",
        kind: "security_review",
        content: "## In short\nSaved cities stay in the browser only.",
        report: writerReport,
      }),
    },
    coder: {
      role: "coder",
      turns: coderWorks({
        assignedWith: "settings page",
        seconds: 25,
        report: coderReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Write a security review and tidy the settings page.");
    await p.heard("The settings page is tidy too.");
    const waited = p.resultOf("c_wait").text;
    p.note("runs wait returned", waited);
    p.note("every message the coordinator received", p.messages("coordinator"));
    expect(waited).toContain(startedRun(p.resultOf("c_write").text));
    expect(waited).toContain('"working"');
    expect(
      p.messages("coordinator").some((m) => m.includes(writerReport)),
    ).toBe(true);
  },
});
