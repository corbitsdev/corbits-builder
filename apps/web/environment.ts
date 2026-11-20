import { origin, port, reader } from "@corbits-builder/environment";
import { type } from "arktype";

// The interface's dev server environment, read by vite.config.ts.
export const webSchema = type({
  "+": "delete",
  UI_PORT: port.default("5173"),
  // The hub the dev server proxies /api to.
  UI_HUB_ORIGIN: origin.default("http://localhost:8000"),
});
export const readWebEnvironment = reader(webSchema);
