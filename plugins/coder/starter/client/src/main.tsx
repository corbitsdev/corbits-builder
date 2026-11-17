import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { ThemeProvider } from "@corbits/react-ui";
import { Toaster, toast } from "@corbits/react-ui/ui/toast";
import { router } from "./routes.tsx";

const queryClient = new QueryClient({
  // A failed request is logged as well as shown, so it never fails silently.
  queryCache: new QueryCache({ onError: (error) => console.error(error) }),
  // A failed save tells the person what went wrong; the screen stays as it was.
  mutationCache: new MutationCache({
    onError: (error) => toast(error.message),
  }),
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultMode="light">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
