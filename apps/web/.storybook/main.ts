import { defineMain } from "@storybook/react-vite/node";

// Storybook reads apps/web/vite.config.ts, so stories build with the same
// plugins the interface does.
export default defineMain({
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  // Serves an MCP endpoint at /mcp on the dev server, so a coding agent can find, preview and
  // read the stories it is changing.
  addons: ["@storybook/addon-mcp"],
  // The addon's docs tools read component props from this manifest, which is off by default.
  features: { componentsManifest: true },
});
