// An oxlint JS plugin that catches the environment reads eslint/no-restricted-properties misses:
// `import.meta.env`, and `process.env` or `Bun.env` reached through `globalThis`. That rule catches
// plain `process.env` and `Bun.env`. Together they make @corbits-builder/environment the only
// reader. JS plugins are alpha in oxlint, so this plugin stays small.

type Node = Readonly<{
  type: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  object?: Node;
  property?: Node;
}>;

type Context = Readonly<{
  report: (problem: { node: Node; message: string }) => void;
}>;

const named = (node: Node | undefined, name: string, computed = false) =>
  computed
    ? node?.type === "Literal" && node.value === name
    : node?.type === "Identifier" && node.name === name;

const property = (node: Node, name: string) =>
  named(node.property, name, node.computed);

const globalRuntime = (node: Node | undefined) =>
  node?.type === "MemberExpression" &&
  named(node.object, "globalThis") &&
  (property(node, "process") || property(node, "Bun"));

export default {
  meta: { name: "environment" },
  rules: {
    "no-direct-read": {
      create(context: Context) {
        return {
          MemberExpression(node: Node) {
            if (!property(node, "env")) return;
            if (
              node.object?.type === "MetaProperty" ||
              globalRuntime(node.object)
            )
              context.report({
                node,
                message:
                  "Read the environment through this process's environment.ts, which validates it with @corbits-builder/environment.",
              });
          },
        };
      },
    },
  },
};
