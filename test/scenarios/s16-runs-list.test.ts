import { expect } from "bun:test";
import { coderWorks, writerFiles } from "./specialists.ts";
import {
  call,
  calls,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const writerReport = "The security review is filed.";
const coderReport = "The settings page is tidy.";

scenario({
  name: "s16-runs-list",
  title:
    "runs list while a writer and a coder work, and again after both reported",
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
      results(ok("c_write", "execute"), ok("c_code", "execute")),
      call("c_list_working", "runs", { operation: "list" }),
    ),
    turn(
      results(ok("c_list_working", "runs")),
      say("A writer and a coder are at work."),
    ),
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
        seconds: 20,
        report: coderReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Write a security review and tidy the settings page.");
    await p.heard("Both have reported.");
    const working = p.resultOf("c_list_working").text;
    const ended = p.resultOf("c_list_ended").text;
    p.note("runs list while both work", working);
    p.note("runs list after both reported", ended);
    const settled = await p.until("both runs to end", async () => {
      const listed = await p.call("GET", `${p.path}/runs`);
      const text = JSON.stringify(listed.body);
      return text.includes('"running"') || text.includes('"deployed"')
        ? undefined
        : listed.body;
    });
    p.note("the hub's runs once both ended", settled);
    expect(working).toContain('"plugin":"writer"');
    expect(working).toContain('"plugin":"coder"');
    expect(ended).toContain('"status":"completed"');
    // A coder's last activity names what its call was given, not the tool alone.
    expect(ended).toContain('"lastActivity":"run_shell sleep 20"');
  },
});
