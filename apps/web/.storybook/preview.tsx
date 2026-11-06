import { useEffect, type ReactNode } from "react";
import { ThemeProvider, useTheme } from "@corbits/react-ui";
import type { Preview } from "@storybook/react-vite";
import { Toaster } from "sonner";
// The same order main.tsx imports them in: the library's sheet, then ours.
import "@corbits/react-ui/styles.css";
import "../src/styles.css";

type Mode = "light" | "dark";

// Follows the toolbar instead of the stored preference, so a story renders
// in the mode the reviewer picked.
function Mode({ mode, children }: { mode: Mode; children: ReactNode }) {
  const { setMode, resolvedMode } = useTheme();
  useEffect(() => setMode(mode), [mode, setMode]);
  return (
    <>
      {children}
      <Toaster theme={resolvedMode} richColors closeButton />
    </>
  );
}

const preview: Preview = {
  globalTypes: {
    mode: {
      description: "Light or dark theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { mode: "light" },
  decorators: [
    (Story, context) => (
      <ThemeProvider storageKey="builder-storybook-theme" defaultMode="light">
        <Mode mode={context.globals["mode"] === "dark" ? "dark" : "light"}>
          <Story />
        </Mode>
      </ThemeProvider>
    ),
  ],
  parameters: {
    layout: "padded",
    controls: { expanded: true },
  },
};

export default preview;
