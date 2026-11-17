import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The server listens on PORT, falling back to Bun.serve's own default.
const api = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The builder runs the app on ports it picks and passes in; a person's `bun run dev` keeps Vite's own.
  // Vite's default host resolves to ::1 on macOS, where the builder's browser at 127.0.0.1 is refused.
  server: {
    ...(process.env.CLIENT_PORT
      ? {
          host: "127.0.0.1",
          port: Number(process.env.CLIENT_PORT),
          strictPort: true,
        }
      : {}),
    // The builder's sandbox may hide native file events, so it asks Vite to poll for changes.
    ...(process.env.WATCH_POLL_MS
      ? {
          watch: {
            usePolling: true,
            interval: Number(process.env.WATCH_POLL_MS),
          },
        }
      : {}),
    proxy: { "/api": api },
  },
});
