import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RoomFault, RoomSkeleton } from "./room-skeleton.tsx";

const meta = {
  title: "Components/Workspace/Room",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

export const Loading: StoryObj = {
  render: () => <RoomSkeleton />,
};

export const Fault: StoryObj<typeof RoomFault> = {
  args: { onRetry: fn() },
  render: (args) => <RoomFault {...args} />,
};
