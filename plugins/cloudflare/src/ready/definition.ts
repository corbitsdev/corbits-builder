import { defineCheck, fail, pass } from "@corbits-builder/plugin";
import { productionCheck } from "@corbits-builder/publishing";
import { CONFIG_FILE, readWorkersConfig } from "../config.ts";

const production = productionCheck({
  notDeclared: "The app does not say how it is built for production",
});

// Reads the config the same way the publish does, so a pass means the publish accepts it.
export default defineCheck({
  describe: {
    summary:
      "Proves the saved app is made to run on Cloudflare Workers: it says how it is built for production and has a wrangler.jsonc a publish to Cloudflare can use.",
    when: "Before publishing to Cloudflare, and again after the app was changed to run on Workers.",
    failed:
      "The app is not made to run on Cloudflare Workers yet; the evidence names what falls short. Start coder change to make it run on Workers as the Workers skill packs describe, naming what the evidence says, then run it again. Nothing on Cloudflare needs doing and the person does nothing technical.",
  },
  async run(view) {
    const declared = await production(view);
    if (!declared.pass) return declared;
    const reading = readWorkersConfig(await view.app.read(CONFIG_FILE));
    if (!reading.ok)
      return fail(
        "The app is not made to run on Cloudflare Workers",
        reading.problems,
      );
    // The evidence names which fields the file sets, never the app's values, because a model reads
    // it.
    const { config } = reading;
    return pass("The app is made to run on Cloudflare Workers", [
      `${CONFIG_FILE} names the worker and the module its build makes`,
      config.assets
        ? "Cloudflare serves its built client"
        : "it serves no client files",
      config.database
        ? "it binds one database, with its migrations"
        : "it binds no database",
    ]);
  },
});
