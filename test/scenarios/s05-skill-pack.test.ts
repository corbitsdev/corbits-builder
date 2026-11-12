import { expect } from "bun:test";
import { coderChange } from "./specialists.ts";
import { execute, ok, results, say, scenario, turn, user } from "./runner.ts";

// The pack the change calls for, as the coder's assignment lists it and its workspace holds it.
const routesPack = ".inputs/skills/web-app-skills/react-router-skills/";
const report = "All text is now set in Inter; check-app passed.";

scenario({
  name: "s05-skill-pack",
  title:
    "the coder's assignment lists its skill packs and the coder opens a pack file from its workspace",
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
      turns: coderChange({
        assignedWith: `- react-router-skills (${routesPack})`,
        open: `${routesPack}routes.md`,
        report,
      }),
    },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("change the font to Inter");
    await p.heard("Your app now uses Inter.");
    const assignment = p.assignment("coder");
    p.note("the coder's assignment", assignment);
    expect(assignment).toContain(".inputs/skills/");
    const opened = p.resultOf("coder_open");
    expect(opened.isError).toBe(false);
    expect(opened.text.length).toBeGreaterThan(100);
  },
});
