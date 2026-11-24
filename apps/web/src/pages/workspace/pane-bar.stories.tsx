import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, Download, Layers, Search, Share2 } from "lucide-react";
import { expect, fn } from "storybook/test";
import { PaneBar, type PaneBarGroup } from "./pane-bar.tsx";

const GROUPS: readonly PaneBarGroup[] = [
  [
    { id: "version", label: "Versions", text: "v3", onSelect: fn() },
    { id: "compare", label: "Compare", onSelect: fn() },
  ],
  [
    { id: "search", label: "Search", icon: <Search />, onSelect: fn() },
    { id: "copy", label: "Copy", icon: <Copy />, onSelect: fn() },
    { id: "download", label: "Download", icon: <Download />, onSelect: fn() },
    { id: "share", label: "Share", icon: <Share2 />, disabled: true },
  ],
];

const meta = {
  title: "Components/Workspace/PaneBar",
  component: PaneBar,
  args: { label: "Document actions", groups: GROUPS },
} satisfies Meta<typeof PaneBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Docked: Story = {};

/** Floats over the foot of a page that fills the pane and folds to a handle. */
export const Floating: Story = {
  args: { floating: true },
  decorators: [
    (Story) => (
      <div data-slot="panel-pane" style={{ position: "relative", height: 320 }}>
        <Story />
      </div>
    ),
  ],
};

export const WithScreens: Story = {
  args: {
    groups: [
      [
        {
          id: "screens",
          label: "Screens",
          row: ["Home", "Orders", "Order", "Settings"].map((name, index) => ({
            id: name,
            label: name,
            text: name,
            active: index === 1,
            onSelect: fn(),
          })),
        },
      ],
      ...GROUPS,
    ],
  },
};

const tallPane: NonNullable<Story["decorators"]> = [
  (Story) => (
    <div data-slot="panel-pane" style={{ position: "relative", height: 440 }}>
      <Story />
    </div>
  ),
];

/** Standing up the edge, the screens are one button naming the one shown, the others in its menu. */
export const FloatingWithScreens: Story = {
  args: { ...WithScreens.args, floating: true },
  decorators: tallPane,
};

/** A strip with an icon of its own keeps to it standing up the edge, so its words never widen the bar. */
export const FloatingWithScreensIcon: Story = {
  args: {
    floating: true,
    groups: [
      [
        {
          id: "screens",
          label: "Screens",
          icon: <Layers />,
          row: ["Home", "Orders", "Order", "Settings"].map((name, index) => ({
            id: name,
            label: name,
            text: name,
            active: index === 1,
            onSelect: fn(),
          })),
        },
      ],
      ...GROUPS,
    ],
  },
  decorators: tallPane,
  play: async ({ canvas }) => {
    const screens = canvas.getByRole("button", { name: "Screens" });
    await expect(screens).not.toHaveTextContent("Orders");
  },
};
