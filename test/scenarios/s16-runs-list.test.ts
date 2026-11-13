import { expect } from "bun:test";
import { type } from "arktype";
import { ProjectRuns } from "@corbits-builder/schemas/artifact";
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

// What runs wait returns: the runs that ended and those still working.
const Waited = type({
  ended: type({ runId: "string" }).array(),
  working: "string[]",
  "+": "ignore",
});

const listed = (text: string) => ProjectRuns.assert(JSON.parse(text)).runs;

scenario({
  name: "s16-runs-list",
  title:
    "runs list while a writer and a coder work, runs wait on both returns when the writer ends, and runs list again after both reported",
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
      call("c_list_working", "runs", { operation: "list" }),
    ),
    turn(
      results(ok("c_list_working", "runs")),
      call("c_wait", "runs", {
        operation: "wait",
        runIds: [bound("writer"), bound("coder")],
        seconds: 60,
      }),
    ),
    turn(results(ok("c_wait", "runs")), say("The writer ended first.")),
    turn(user(writerReport), say("The security review is in.")),
    turn(
      user(coderReport),
      call("c_list_ended", "runs", { operation: "list" }),
    ),
    turn(results(ok("c_list_ended", "runs")), say("Both have reported.")),
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
    await p.heard("Both have reported.");
    const writer = startedRun(p.resultOf("c_write").text);
    const coder = startedRun(p.resultOf("c_code").text);
    const working = listed(p.resultOf("c_list_working").text);
    const waited = Waited.assert(JSON.parse(p.resultOf("c_wait").text));
    const ended = listed(p.resultOf("c_list_ended").text);
    p.note("runs list while both work", working);
    p.note("runs wait returned", waited);
    p.note("runs list after both reported", ended);
    expect(working.map(({ runId }) => runId)).toEqual(
      expect.arrayContaining([writer, coder]),
    );
    // The wait returned once the writer ended, with the coder still at work.
    expect(waited.ended.map(({ runId }) => runId)).toEqual([writer]);
    expect(waited.working).toEqual([coder]);
    expect(ended.map(({ runId }) => runId)).toEqual(
      expect.arrayContaining([writer, coder]),
    );
    const settled = await p.until("both runs to end", async () => {
      const read = await p.call("GET", `${p.path}/runs`);
      const statuses = ProjectRuns.assert(read.body)
        .runs.filter(({ runId }) => runId === writer || runId === coder)
        .map(({ status }) => status);
      return statuses.some(
        (status) => status === "running" || status === "deployed",
      )
        ? undefined
        : statuses;
    });
    expect(settled).toEqual(["completed", "completed"]);
  },
});
