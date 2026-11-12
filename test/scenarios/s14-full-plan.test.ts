import { expect } from "bun:test";
import {
  buildWeather,
  scenario,
  WEATHER_BUILD,
  WEATHER_IDEA,
  WEATHER_REQUIREMENTS,
  WEATHER_SPECIALISTS,
} from "./runner.ts";

scenario({
  name: "s14-full-plan",
  title:
    "build-web-app on a fresh project: requirements approved, a design chosen, a plan approved, the app built",
  start: { fresh: WEATHER_IDEA },
  coordinator: [...WEATHER_REQUIREMENTS, ...WEATHER_BUILD],
  specialists: WEATHER_SPECIALISTS,
  person: async (p) => {
    await buildWeather(p);
    // What ends the plan holds, so the project is no longer following it.
    const following = await p.call("GET", `${p.path}/following`);
    p.note("the plans the project is following at the end", following.body);
    const design = await p.filed("design");
    expect(design.approvedVersion).toBe(design.version);
  },
});
