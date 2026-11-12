import { expect } from "bun:test";
import { coderChange } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

const address = "https://brand.example.com/guidelines";
const sentence =
  "This is a link the person gave; what it points to is the value.";
const report = "All text is now set in Inter; check-app passed.";

scenario({
  name: "s30-brand-guidelines-as-link",
  title:
    "brand guidelines the person gives as a link reach the coder's assignment as the address and a sentence saying so, and an address that is not http or https is refused",
  start: "weather-app",
  coordinator: [
    turn(
      user("change the font to Inter"),
      execute("c_change", "coder", "change", {
        instruction:
          "Change the app's font to Inter for all text: set the body font-family to Inter in client/src/styles.css.",
      }),
    ),
    turn(results(ok("c_change", "execute")), say("A coder is on it.")),
    turn(user(report), say("Your app now uses Inter.")),
  ],
  specialists: {
    coder: {
      role: "coder",
      turns: coderChange({ assignedWith: address, report }),
    },
  },
  values: ["brand.guidelines"],
  person: async (p) => {
    await p.heard("The project is imported.");
    const values = `${p.path}/values`;

    const refused = await p.call("POST", values, {
      values: { "brand.guidelines": { link: "ftp://brand.example.com/guide" } },
    });
    p.note("an ftp address", refused);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("http or https address");

    const saved = await p.call("POST", values, {
      values: { "brand.guidelines": { link: address } },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      values: { "brand.guidelines": { link: address } },
    });

    // Every declared value with what it takes, as the project values tab reads them.
    const declared = await p.call("GET", values);
    p.note("every declared value", declared);
    expect(JSON.stringify(declared.body)).toContain(
      '"brand.guidelines":{"about"',
    );
    expect(JSON.stringify(declared.body)).toContain(
      '"types":["text","link","file"]',
    );

    await p.say("change the font to Inter");
    await p.heard("Your app now uses Inter.");
    const assignment = p.assignment("coder");
    p.note("the coder's assignment", assignment);
    expect(assignment).toContain(`Value: ${address}`);
    expect(assignment).toContain(sentence);
  },
});
