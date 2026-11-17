import { defineCheck } from "@corbits-builder/plugin";

export default defineCheck({
  describe: {
    when: "Before showing, filing or deploying the project's code, to prove its saved version still builds.",
    failed:
      "The saved code does not build or its own checks fail, and the evidence holds their output. Have the coder fix it with coder change, passing that output on, then run it again.",
  },
});
