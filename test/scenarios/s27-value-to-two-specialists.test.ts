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

const address = "https://brand.example.com/guidelines";
const writerReport = "The release notes are filed.";
const coderReport = "The settings page is tidy.";

scenario({
  name: "s27-value-to-two-specialists",
  title:
    "brand guidelines the person saves as a link reach both a writer's and a coder's assignment; a link that is not http or https, and a plugin selection naming no installed plugin, are refused",
  start: "weather-app",
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
  values: ["brand.guidelines", "plugins.build-web-app"],
  person: async (p) => {
    await p.heard("The project is imported.");
    const values = `${p.path}/values`;
    const ftp = await p.call("POST", values, {
      values: { "brand.guidelines": { link: "ftp://brand.example.com/guide" } },
    });
    expect(ftp.status).toBe(400);
    const uninstalled = await p.call("POST", values, {
      values: { "plugins.build-web-app": "@corbits-builder/not-installed" },
    });
    expect(uninstalled.status).toBe(400);
    const saved = await p.call("POST", values, {
      values: { "brand.guidelines": { link: address } },
    });
    expect(saved.status).toBe(200);

    await p.say("Write release notes and tidy the settings page.");
    await p.heard("Both have reported.");
    const writer = p.assignment("writer");
    const coder = p.assignment("coder");
    p.note("the writer's assignment", writer);
    p.note("the coder's assignment", coder);
    expect(writer).toContain(address);
    expect(coder).toContain(address);
  },
});
