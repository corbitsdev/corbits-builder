import { environment, origin, port } from "@corbits-builder/environment";
import { type } from "arktype";

// The interface's dev server environment, read by vite.config.ts. The interface's own code runs in
// the browser and reads only Vite's build mode, through src/build-mode.ts.
export const readWebEnvironment = environment(
  type({
    UI_PORT: port.default("5173"),
    // The hub the dev server proxies /api to.
    UI_HUB_ORIGIN: origin.default("http://localhost:8000"),
  }),
);
