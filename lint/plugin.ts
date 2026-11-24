import noPlanStateCheck from "./rules/no-plan-state-check.ts";
import noToolReplay from "./rules/no-tool-replay.ts";

export default {
  meta: { name: "corbits-builder" },
  rules: {
    "no-plan-state-check": noPlanStateCheck,
    "no-tool-replay": noToolReplay,
  },
};
