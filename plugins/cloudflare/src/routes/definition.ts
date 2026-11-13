import { defineCheck, fail, file, pass } from "@corbits-builder/plugin";

// A route in wrangler.toml: "route = ...", "routes = [...]", or a [[routes]] table.
const ROUTE = /^\s*(routes?\s*=|\[\[routes\]\])/;

// Without a route a Worker answers only on its workers.dev address.
export default defineCheck({
  async run(view) {
    const config = await view.check(file("wrangler.toml"));
    if (!config.pass) return config;
    const lines = (await view.app.read("wrangler.toml"))?.split("\n") ?? [];
    const routes = lines.filter((line) => ROUTE.test(line));
    if (routes.length === 0)
      return fail("wrangler.toml declares no route", [
        "wrangler.toml has no route =, routes = or [[routes]]",
      ]);
    return pass(
      "wrangler.toml declares a route",
      routes.map((line) => line.trim()),
    );
  },
});
