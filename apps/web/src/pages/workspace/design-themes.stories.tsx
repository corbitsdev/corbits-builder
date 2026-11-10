import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { firstPage } from "./design-bundle.ts";
import {
  DesignThemesView,
  type DesignThemesViewProps,
  type OpenedTheme,
  type ThemeCard,
} from "./design-themes.view.tsx";
import { sampleDesign } from "./sample-design.ts";

const themes: readonly ThemeCard[] = [
  {
    id: "paper",
    name: "Paper",
    direction: "Warm paper tones with one orange accent.",
    page: firstPage(sampleDesign),
  },
  {
    id: "quiet",
    name: "Quiet",
    direction: "Cool greys, generous space and small type.",
    page: firstPage(sampleDesign),
  },
  {
    id: "bold",
    name: "Bold",
    direction: "High contrast, big headings and square corners.",
    page: null,
  },
];

const paper: OpenedTheme = {
  id: "paper",
  name: "Paper",
  example: sampleDesign,
  onUse: fn(),
};

// Holds which theme is open; every card opens the one theme the stories have an example for.
function Gallery(args: DesignThemesViewProps) {
  const [opened, setOpened] = useState(args.opened);
  return (
    <div style={{ height: 640, display: "flex", flexDirection: "column" }}>
      <DesignThemesView
        {...args}
        opened={opened}
        onOpen={() => setOpened(paper)}
        onBack={() => setOpened(null)}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/DesignThemes",
  component: DesignThemesView,
  parameters: { layout: "fullscreen" },
  args: {
    themes,
    opened: null,
    onOpen: fn(),
    onBack: fn(),
  },
  render: (args) => <Gallery {...args} />,
} satisfies Meta<typeof DesignThemesView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each theme's example as a still picture; the last one's is still being read. */
export const AllThemes: Story = {};

export const Loading: Story = { args: { themes: "loading" } };

export const Failed: Story = { args: { themes: "failed" } };

/** One theme opened to click through and tweak; "Use this theme" asks for the app in it. */
export const ThemeOpened: Story = {
  args: { opened: paper },
};

export const OpenedThemeLoading: Story = {
  args: { opened: { ...paper, id: "bold", name: "Bold", example: "loading" } },
};

export const OpenedThemeFailed: Story = {
  args: { opened: { ...paper, id: "bold", name: "Bold", example: "failed" } },
};
