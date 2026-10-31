import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { productName } from "./src/config.ts";

// The hub's real sign-in needs its own origin on the request; the dev proxy
// stands in for same-origin serving so the hub sees a trusted request.
const hubOrigin = process.env["UI_HUB_ORIGIN"] ?? "http://localhost:8000";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "product-name-title",
      transformIndexHtml: (html: string) =>
        html.replace("%PRODUCT_NAME%", productName),
    },
  ],
  // main.tsx awaits the persisted query cache before the first render.
  build: { target: "es2022" },
  server: {
    port: Number(process.env["UI_PORT"] ?? 5173),
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
