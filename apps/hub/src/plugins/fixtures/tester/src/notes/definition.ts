import { defineScreen } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineScreen({
  places: { "main-pane": {} },
  state: (project) => {
    const notes = project.value("tester.notes");
    return typeof notes === "string" ? { notes } : undefined;
  },
  input: type({ "+": "reject" }),
  output: type({ "+": "reject" }),
  describe: {
    summary: "Shows what the person last asked the tester to look into.",
    when: "The person left the tester a note.",
    unless: "They left none.",
    fields: {},
  },
});
