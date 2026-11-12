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
  name: "s14-full-route",
  title:
    "build-web-app on a fresh project: requirements approved, a design chosen, a plan approved, the app built",
  start: { fresh: WEATHER_IDEA },
  coordinator: [...WEATHER_REQUIREMENTS, ...WEATHER_BUILD],
  specialists: WEATHER_SPECIALISTS,
  person: async (p) => {
    await buildWeather(p);
    // The route's outcome holds, so the project no longer follows it.
    const route = await p.call("GET", `${p.path}/routes`);
    p.note("the routes the project follows at the end", route.body);
    const design = await p.filed("design");
    expect(design.approvedVersion).toBe(design.version);
  },
});
