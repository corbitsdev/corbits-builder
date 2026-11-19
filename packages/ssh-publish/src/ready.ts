import {
  declaredProduction,
  fail,
  pass,
  type ProjectView,
} from "@corbits-builder/plugin";
import { type } from "arktype";

/**
 * For defineCheck: checks that the saved app says how it runs in production. It reads the same
 * values a release reads, so a pass means a release can use them.
 */
export async function productionReady(view: ProjectView) {
  const production = declaredProduction({
    "stack.production": await view.values("stack.production"),
  });
  if (production === undefined)
    return fail("The app does not say how it runs in production", [
      "the project's stack.production is not set",
    ]);
  if (production instanceof type.errors)
    return fail("The app's production settings cannot be used", [
      production.summary,
    ]);
  return pass("The app says how it runs in production", [
    "it says how it installs, builds and starts",
    `it answers on the port in ${production.port}`,
    production.data.length === 0
      ? "it keeps no data between releases"
      : `it keeps ${production.data.join(", ")} between releases`,
  ]);
}
