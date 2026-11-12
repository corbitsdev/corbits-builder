// The global sheets load before any module that imports a component, so each
// component's own CSS module comes after them and wins a tie. The library's
// sheet carries the Tailwind reset and the shared theme; ours adds the tokens
// and element defaults on top of it.
import "@corbits/react-ui/styles.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@corbits/react-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.jsx";
import "./pages/workspace/screen-files.ts";
import { queryCacheReady, queryClient } from "./queries/client.ts";
import { openSharedEventSource } from "./shared-event-source.ts";
import { redirectHashLink } from "./routes.ts";
import { wording } from "./config.ts";

// Compiled out of a production bundle: `bun run dev` rebuilds the interface on
// every edit, and this is how the window hears about it.
if (import.meta.env.DEV) {
  // Through the shared source so a hidden tab holds no connection for it.
  const source = openSharedEventSource("/api/dev/reload", false);
  source.addEventListener("rebuilt", () => location.reload());
}

redirectHashLink();
console.log(
  `%c${wording.flourish.consoleNote}`,
  "font-size:13px;font-weight:600",
);
const root = document.getElementById("root");
if (!root) throw new Error("The app root element is missing from index.html.");
await queryCacheReady;
createRoot(root).render(
  <StrictMode>
    {/* Light unless the person chooses otherwise: the reading surfaces — a
        brief, a plan, a manifest — are designed light first. */}
    <ThemeProvider storageKey="builder-theme" defaultMode="light">
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
