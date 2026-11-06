import { defineMain } from "@storybook/react-vite/node";

// Storybook reads apps/web/vite.config.ts, so stories build with the same
// plugins the interface does.
export default defineMain({
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
});
