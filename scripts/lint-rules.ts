// Custom oxlint rules, loaded through jsPlugins in .oxlintrc.json.

const TOOL_REPLAY = "toolReplay";

type Node = { key?: { name?: string; value?: unknown } };
type Context = { report: (report: { node: Node; message: string }) => void };

export default {
  meta: { name: "corbits-builder" },
  rules: {
    // A hub given toolReplay answers tools from recordings instead of running them, so only tests
    // may pass it; .oxlintrc.json turns this off for test/.
    "no-tool-replay": {
      create: (context: Context) => ({
        Property(node: Node) {
          if (node.key?.name === TOOL_REPLAY || node.key?.value === TOOL_REPLAY)
            context.report({
              node,
              message:
                "Only tests pass toolReplay: it makes the hub answer tools from recordings.",
            });
        },
      }),
    },
  },
};
