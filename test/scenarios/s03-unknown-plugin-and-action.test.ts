import { expect } from "bun:test";
import {
  execute,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

scenario({
  name: "s03-unknown-plugin-and-action",
  title:
    "an unknown plugin, an unknown action and an unknown screen are refused with what exists",
  start: { fresh: "Paint me a logo for my bakery." },
  coordinator: [
    turn(
      user("logo"),
      execute("c_plugin", "painter", "paint", { instruction: "A logo." }),
    ),
    turn(
      results(refused("c_plugin", "execute")),
      execute("c_action", "designer", "paint", { instruction: "A logo." }),
    ),
    turn(
      results(refused("c_action", "execute")),
      execute("c_screen", "designer", "pick-logo", {}),
    ),
    turn(
      results(refused("c_screen", "execute")),
      say("I cannot paint logos yet."),
    ),
  ],
  person: async (p) => {
    await p.heard("I cannot paint logos yet.");
    const plugin = p.resultOf("c_plugin").text;
    const action = p.resultOf("c_action").text;
    const screen = p.resultOf("c_screen").text;
    p.note("unknown plugin", plugin);
    p.note("unknown action", action);
    p.note("unknown screen", screen);
    expect(plugin).toContain("painter");
    expect(plugin).toContain("designer mockup");
    expect(plugin).toContain("build-web-app");
    expect(action).toContain("paint");
    expect(action).toContain("mockup");
    expect(action).toContain("pick-fonts");
    expect(screen).toContain("pick-logo");
    expect(screen).toContain("pick-fonts");
  },
});
