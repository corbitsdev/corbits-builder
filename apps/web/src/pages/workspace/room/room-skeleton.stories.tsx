import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn } from "storybook/test";
import { wording } from "../../../config.ts";
import { RoomFault, RoomSkeleton } from "./room-skeleton.tsx";

const meta = {
  title: "Components/Workspace/Room",
  parameters: { layout: "fullscreen" },
  // The stage fills the window's height in the app.
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof RoomSkeleton>;

const opened = {
  title: "Weather dashboard",
  sidebar: {
    open: true,
    drawer: false,
    onToggleSidebar: fn(),
    onHome: fn(),
    onPreferences: fn(),
  },
};

export const Loading: Story = {
  args: opened,
  render: (args) => <RoomSkeleton {...args} />,
  play: async ({ canvas }) => {
    // The box says what is opening, and takes nothing typed until the room is there.
    await expect(canvas.getByRole("status")).toHaveTextContent(
      wording.message.projectLoading("Weather dashboard"),
    );
    await expect(canvas.getByRole("textbox", { hidden: true })).toBeDisabled();
  },
};

/** A project just started takes its first words as its name; the box stays the room's empty box. */
export const LoadingLongTitle: Story = {
  args: {
    ...opened,
    title:
      "Can you build me a calculator app that I can use and also which helps me track expenses daily and hit some target goal, lets say whatever I set",
  },
  render: (args) => <RoomSkeleton {...args} />,
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole("textbox", { hidden: true })).toHaveAttribute(
      "placeholder",
      wording.composer.reply,
    );
    const foot = canvasElement.querySelector('[data-slot="composer"]');
    const box = canvasElement.querySelector('[data-slot="composer-box"]');
    await expect(foot).not.toBeNull();
    await expect(box).not.toBeNull();
    if (foot === null || box === null) return;
    // The box keeps inside its column, however long the name.
    await expect(box.getBoundingClientRect().right).toBeLessThanOrEqual(
      foot.getBoundingClientRect().right + 1,
    );
  },
};

export const LoadingSidebarClosed: Story = {
  args: { ...opened, sidebar: { ...opened.sidebar, open: false } },
  render: (args) => <RoomSkeleton {...args} />,
};

export const LoadingDark: Story = {
  args: opened,
  globals: { mode: "dark" },
  render: (args) => <RoomSkeleton {...args} />,
};

export const LoadingNarrow: Story = {
  args: {
    ...opened,
    sidebar: { ...opened.sidebar, open: false, drawer: true },
  },
  globals: { viewport: { value: "mobile1" } },
  render: (args) => <RoomSkeleton {...args} />,
};

export const Fault: StoryObj<typeof RoomFault> = {
  args: { onRetry: fn() },
  render: (args) => <RoomFault {...args} />,
};
