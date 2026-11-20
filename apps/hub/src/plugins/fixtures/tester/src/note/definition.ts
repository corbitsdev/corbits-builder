import { defineTask } from "@corbits-builder/plugin";
import { type } from "arktype";

export default defineTask({
  says: "The person left the tester a note.",
  input: type({ "+": "reject", text: "string > 0" }),
  describe: { fields: { text: { about: "What to look into" } } },
  writes: ["tester.notes"],
  run: (_project, { text }) => ({
    saves: [{ name: "tester.notes", value: text }],
    note: `Look into: ${text}`,
  }),
});
