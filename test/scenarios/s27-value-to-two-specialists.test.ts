import { expect } from "bun:test";
import { coderReports, writerFiles } from "./specialists.ts";
import {
  calls,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const guidelines =
  "Warm and plain. Never use exclamation marks. Prefer Inter for all text.";
const writerReport = "The release notes are filed.";
const coderReport = "The settings page is tidy.";

scenario({
  name: "s27-value-to-two-specialists",
  title:
    "brand guidelines the person saved reach both a writer's and a coder's assignment",
  start: "weather-app",
  expectFailure:
    'writer write declares no reads, so its assignment carries no project values; only coder change, which reads brand.guidelines and stack.language, gets the guidelines. The writer\'s actions would need reads: ["brand.guidelines"] in plugins/writer/package.json',
  coordinator: [
    turn(
      user("release notes"),
      calls(
        execute("c_write", "writer", "write", {
          kind: "release_notes",
          title: "Release notes",
          instruction:
            "Write release notes for the latest version of the weather app.",
        }),
        execute("c_change", "coder", "change", {
          instruction:
            "Tidy the settings page: align the labels and group the unit toggles.",
        }),
      ),
    ),
    turn(
      results(ok("c_write", "execute"), ok("c_change", "execute")),
      say("A writer and a coder are on it."),
    ),
    turn(user(), say("One has reported.")),
    turn(user(), say("Both have reported.")),
  ],
  specialists: {
    writer: {
      role: "writer",
      turns: writerFiles({
        assignedWith: "release_notes",
        kind: "release_notes",
        content: "## In short\nThe settings page is tidier.",
        report: writerReport,
      }),
    },
    coder: {
      role: "coder",
      turns: coderReports({
        assignedWith: "settings page",
        report: coderReport,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    const saved = await p.call("POST", `${p.path}/values`, {
      values: { "brand.guidelines": guidelines },
    });
    expect(saved.status).toBe(200);
    await p.say("Write release notes and tidy the settings page.");
    await p.heard("Both have reported.");
    const writer = p.assignment("writer");
    const coder = p.assignment("coder");
    p.note("the writer's assignment", writer);
    p.note("the coder's assignment", coder);
    p.note(
      "the writer's assignment has the guidelines",
      writer.includes(guidelines),
    );
    p.note(
      "the coder's assignment has the guidelines",
      coder.includes(guidelines),
    );
    expect(coder).toContain(guidelines);
    expect(writer).toContain(guidelines);
  },
});
