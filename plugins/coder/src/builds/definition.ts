import { defineCheck } from "@corbits-builder/plugin";

export default defineCheck({
  describe: {
    when: "Before showing, filing or deploying the project's code, to prove its saved version still builds.",
  },
});
