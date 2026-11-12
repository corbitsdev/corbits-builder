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

const lookUp = (asked: string) => [
  turn(
    user(asked),
    calls(
      ...Object.entries(QUERIES).map(([id, query]) =>
        call(id, "discover", { query }),
      ),
    ),
  ),
  turn(
    results(...Object.keys(QUERIES).map((id) => ok(id, "discover"))),
    say("I looked everything up."),
  ),
];

async function record(p: Person) {
  await p.heard("I looked everything up.");
  for (const [id, query] of Object.entries(QUERIES))
    p.note(`discover "${query}"`, p.resultOf(id).text);
  expect(p.resultOf("d_font").text).toContain("pick-fonts");
  expect(p.resultOf("d_review").text).toContain("writer write");
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
