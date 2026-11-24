import type { Name, Rule } from "../rule.ts";

const NAMES = new Set(["toolReplay", "replay"]);
const MESSAGE =
  "Only tests set tool replay: it makes the hub answer tools from recordings.";

const named = (name: Name | undefined) =>
  NAMES.has(String(name?.name ?? name?.value));

// A hub given a replay module answers tools from recordings instead of running them, so only tests
// pass one. It is off in test/, and app.ts's one line that takes it disables it inline.
const rule: Rule = {
  create: (context) => ({
    Property(node) {
      if (named(node.key)) context.report({ node, message: MESSAGE });
    },
    AssignmentExpression(node) {
      if (named(node.left?.property))
        context.report({ node, message: MESSAGE });
    },
  }),
};
export default rule;
