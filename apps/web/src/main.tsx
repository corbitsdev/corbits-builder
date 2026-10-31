import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@corbits/react-ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.jsx";
import { queryCacheReady, queryClient } from "./queries/client.ts";
// The Corbits component library first — it carries the Tailwind reset and the
// shared theme — then our own sheet, which overrides it for surfaces this app
// owns. Order is the whole contract.
import "@corbits/react-ui/styles.css";
import "./styles.css";
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
