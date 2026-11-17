import { defineWorkspace } from "@corbits-builder/plugin";
import {
  checkModules,
  checkScript,
} from "@corbits-builder/app-checks" with { type: "macro" };

// The designer works in its mockup, which check_design proves with check-app.
export default defineWorkspace({
  kind: "design",
  commands: { "check-app": checkScript("check-app") },
  commandModules: checkModules(),
});
