const { builtinModules } = require("node:module");

module.exports = {
  forbidden: [
    {
      name: "no-circular-at-runtime",
      // Runtime cycles make module initialization depend on import order.
      severity: "error",
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ["type-only"] } },
    },
    {
      name: "plugin-isolation",
      comment:
        "A plugin must run without the hub, the host or any other plugin, so it may only depend on shared packages.",
      severity: "error",
      from: { path: "^plugins/([^/]+)/" },
      to: {
        path: ["^apps/", "^packages/plugin-host/", "^plugins/([^/]+)/"],
        pathNot: "^plugins/$1/",
      },
    },
    {
      name: "apps-and-workflows-do-not-import-plugins",
      // A plugin can be added, renamed or removed without touching an app.
      severity: "error",
      from: { path: "^(apps|workflows)/" },
      to: { path: "^plugins/" },
    },
    {
      name: "plugin-host-only-from-hub",
      comment:
        "The plugin host is the hub's loader; anything else importing it would couple itself to how plugins load.",
      severity: "error",
      from: { pathNot: "^(apps/hub/|packages/plugin-host/)" },
      to: { path: "^packages/plugin-host/" },
    },
    {
      name: "environment-read-in-environment-ts",
      comment:
        "Each process holds every variable it reads in one environment.ts, so only those files read through the environment package.",
      severity: "error",
      from: {
        pathNot: [
          "(^|/)environment\\.ts$",
          "^packages/environment/",
          "\\.test\\.tsx?$",
        ],
      },
      to: {
        path: "^packages/environment/src/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "environment-not-in-browser",
      comment:
        "The environment package reads process.env, so neither the interface's browser code nor a package it bundles imports it; apps/web/environment.ts and vite.config.ts run in Node and may.",
      severity: "error",
      from: {
        path: "^(apps/web/src|packages/(client|plugin|plugin-ui|schemas))/",
      },
      to: { path: "^packages/environment/" },
    },
    {
      name: "hub-environment-read-by-entry-points",
      comment:
        "The hub's entry points read the environment once and pass it down; any other module takes the settings it needs as arguments, so it imports only the environment's types.",
      severity: "error",
      from: {
        path: "^apps/hub/src/",
        pathNot: [
          "^apps/hub/src/(server|migrate|setup)\\.ts$",
          "\\.test\\.ts$",
        ],
      },
      to: {
        path: "^apps/hub/src/environment\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "packages-stay-below-apps-and-plugins",
      comment:
        "Packages are shared building blocks, so they must not depend on the apps or plugins that use them.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^(apps|plugins)/" },
    },
    {
      name: "schemas-stay-at-the-bottom",
      comment:
        "Schemas hold the shapes and rules every layer reads, such as the plan and when its work is finished, so they depend on nothing but other schemas.",
      severity: "error",
      from: { path: "^packages/schemas/" },
      to: {
        path: "^(apps|packages|plugins|workflows)/",
        pathNot: "^packages/schemas/",
      },
    },
    {
      name: "browser-files-stay-off-node",
      comment:
        "The interface bundles each plugin's definitions and views, so nothing they reach may need Node or Bun; a browser build only externalizes those modules and the page fails when it loads.",
      severity: "error",
      from: {
        path: [
          "^plugins/[^/]+/src/[^/]+/(definition\\.ts|view\\.tsx)$",
          "^apps/web/src/",
        ],
        pathNot: "\\.(test|stories|testing)\\.tsx?$",
      },
      to: {
        // Core modules resolve by bare name, without the node: prefix. Each module has its own
        // pattern because one alternation of them all is refused as an unsafe regular expression.
        path: [...builtinModules.map((name) => `^${name}$`), "^bun(:|$)"],
        reachable: true,
      },
    },
  ],
  options: {
    exclude: { path: "(^|/)(node_modules|vendor|dist)/" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["intx-src", "import", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
    },
  },
};
