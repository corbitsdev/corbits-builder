import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { readWebEnvironment } from "./environment.ts";
import { productName } from "./src/config.ts";

const { UI_PORT, UI_HUB_ORIGIN } = readWebEnvironment();
// The hub's real sign-in needs its own origin on the request; the dev proxy
// stands in for same-origin serving so the hub sees a trusted request.
const hubOrigin = UI_HUB_ORIGIN;

export default defineConfig({
  plugins: [
    react(),
    {
      name: "product-name-title",
      transformIndexHtml: (html: string) =>
        html.replace("%PRODUCT_NAME%", productName),
    },
  ],
  resolve: {
    // Interchange ships its packages as source; the hub and tests read them the same way.
    conditions: ["intx-src", ...defaultClientConditions],
    alias: {
      "@plugins": fileURLToPath(new URL("../../plugins", import.meta.url)),
    },
  },
  // main.tsx awaits the persisted query cache before the first render.
  build: { target: "es2022" },
  server: {
    port: UI_PORT,
    // The hub trusts exactly this origin, so a taken port fails instead of moving.
    strictPort: true,
    proxy: {
      "/api": {
        target: hubOrigin,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on("proxyReq", function forwardHubOrigin(proxyReq) {
            proxyReq.setHeader("origin", hubOrigin);
          });
        },
      },
    },
  },
});
