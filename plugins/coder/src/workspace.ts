import { defineWorkspace } from "@corbits-builder/plugin";
import {
  checkModules,
  checkScript,
} from "@corbits-builder/app-checks" with { type: "macro" };
import { coderScript } from "./check.ts" with { type: "macro" };
import { kitDigest } from "./kit.ts" with { type: "macro" };

// Macros, so the files are read once where this module is transpiled: the hub's built packages
// load the catalog, and with it this module, far from the files.

// The coder works in the project's code: check-stack finishes every coder, check-app proves a web
// app the starter's BUILDER-CHECKS.txt names it for, and installing a package asks the person.
export default defineWorkspace({
  kind: "app",
  commands: {
    "check-stack": coderScript("check-stack"),
    "check-app": checkScript("check-app"),
  },
  commandModules: checkModules(),
  pageWatcher: coderScript("watch-page"),
  kit: kitDigest(),
  browser: true,
  packageInstall: "ask",
});
