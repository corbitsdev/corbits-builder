const NAMES = new Set(["toolReplay", "replay"]);
const MESSAGE =
  "Only tests set tool replay: it makes the hub answer tools from recordings.";

type Name = { name?: string; value?: unknown };
type Node = { key?: Name; left?: { property?: Name } };
type Context = { report: (report: { node: Node; message: string }) => void };

const named = (name: Name | undefined) =>
  NAMES.has(String(name?.name ?? name?.value));

export default {
  meta: { name: "corbits-builder" },
  rules: {
    // A hub given a replay module answers tools from recordings instead of running them, so only
    // tests pass one. It is off in test/, and app.ts's one line that takes it disables it inline.
    "no-tool-replay": {
      create: (context: Context) => ({
        Property(node: Node) {
          if (named(node.key)) context.report({ node, message: MESSAGE });
        },
        AssignmentExpression(node: Node) {
          if (named(node.left?.property))
            context.report({ node, message: MESSAGE });
        },
      }),
    },
  },
};
