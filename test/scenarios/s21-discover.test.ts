import { expect } from "bun:test";
import {
  call,
  calls,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

// What a person's words would lead the coordinator to look up, the last matching nothing.
const QUERIES = {
  d_font: "the font is ugly",
  d_review: "write me a security review",
  d_anything: "what can you do",
  d_nothing: "zebra quantum saxophone",
};

// A tool result keeps 10,000 characters; the listing must leave the values and the way on whole.
const KEPT = 10_000;

const lookUp = (asked: string) => [
  turn(
    user(asked),
    calls(
      ...Object.entries(QUERIES).map(([id, query]) =>
        call(id, "discover", { query }),
      ),
      call("d_action", "discover", { plugin: "writer", action: "write" }),
    ),
  ),
  turn(
    results(
      ...[...Object.keys(QUERIES), "d_action"].map((id) => ok(id, "discover")),
    ),
    say("I looked everything up."),
  ),
];

async function record(p: Person) {
  await p.heard("I looked everything up.");
  for (const [id, query] of Object.entries(QUERIES))
    p.note(`discover "${query}"`, p.resultOf(id).text);
  p.note("discover writer write", p.resultOf("d_action").text);
  expect(p.resultOf("d_font").text).toContain("pick-fonts (screen)");
  expect(p.resultOf("d_review").text).toContain("  write: ");
  const anything = p.resultOf("d_anything").text;
  expect(anything.length).toBeLessThan(KEPT);
  expect(anything).toContain("Project values");
  expect(anything).toEndWith("discover({ plugin }) gives all of a plugin's.");
  expect(p.resultOf("d_action").text).toContain("Input:");
}

scenario({
  name: "s21-discover-fresh",
  title: "discover on a fresh project, for what a person's words lead to",
  start: { fresh: "Help me with my bakery's website, the font is ugly." },
  coordinator: lookUp("bakery"),
  person: record,
});

scenario({
  name: "s21-discover-with-app",
  title: "discover on a project with an app, for what a person's words lead to",
  start: "weather-app",
  coordinator: lookUp("look things up"),
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Please look things up for me.");
    await record(p);
  },
});
