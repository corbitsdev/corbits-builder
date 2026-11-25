import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import { AppLine, type AppLineProps } from "./app-line.tsx";

const words = wording.projectShell;

// Holds what the page would: whether the app is on it, so a story can be clicked through.
function Clickable(args: AppLineProps) {
  const [open, setOpen] = useState(args.open);
  return (
    <AppLine
      {...args}
      open={open}
      onOpen={() => {
        setOpen(true);
        args.onOpen();
      }}
    />
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar/AppLine",
  component: AppLine,
  args: { app: "running", open: false, onOpen: fn() },
  render: (args) => (
    <div
      style={{
        width: "calc(var(--rail-width) - 2 * var(--space-2))",
        padding: "var(--space-2)",
        background: "var(--card)",
      }}
    >
      <Clickable {...args} />
    </div>
  ),
} satisfies Meta<typeof AppLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The line opens the app and is marked once it is on the page. */
export const Running: Story = {
  play: async ({ canvasElement, args }) => {
    const line = within(canvasElement).getByRole("button", {
      name: words.appState.running,
    });
    await expect(line).toHaveAttribute("title", words.openApp);
    await userEvent.click(line);
    await expect(args.onOpen).toHaveBeenCalled();
    await expect(line).toHaveAttribute("data-current");
  },
};

/** The app is starting: the line says so until it is up. */
export const Starting: Story = { args: { app: "starting" } };

/** Nothing runs the app right now; opening it starts it again. */
export const Stopped: Story = { args: { app: "stopped" } };

/** The app could not start; opening it shows why. */
export const Failed: Story = { args: { app: "failed" } };

export const FailedDark: Story = {
  args: { app: "failed" },
  globals: { mode: "dark" },
};

/** Before there is an app there is no line for it. */
export const NotBuilt: Story = {
  args: { app: "not_built" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTitle(words.openApp)).toBeNull();
  },
};
