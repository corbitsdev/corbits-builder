/**
 * `bun test` has no CSS modules: an import of one comes back empty, so every
 * class would render as `undefined`. Here each class comes back as its own
 * name instead, which keeps rendered markup readable in assertions.
 */
import { plugin } from "bun";

plugin({
  name: "css-modules",
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      loader: "js",
      contents:
        "export default new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) });",
    }));
  },
});
