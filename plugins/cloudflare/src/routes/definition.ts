import { defineCheck, fail, file, pass } from "@corbits-builder/plugin";

// A route in wrangler.toml: "route = ...", "routes = [...]", or a [[routes]] table.
const ROUTE = /^\s*(routes?\s*=|\[\[routes\]\])/;

// Without a route a Worker answers only on its workers.dev address.
export default defineCheck({
  describe: {
    summary: "Proves the app's wrangler.toml routes the Worker to a domain.",
    when: "Once the app is ready for Cloudflare, before deploying it to the person's own domain, which a Worker answers only through a route.",
    failed:
      "wrangler.toml is missing or routes the Worker nowhere, so it would answer only on its workers.dev address. Ask the person which domain it should answer on if they have not said, have the coder add the route with coder change, then run it again.",
  },
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
