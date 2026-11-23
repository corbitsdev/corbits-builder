import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogoMark } from "./flourish.tsx";

const meta = {
  title: "Components/Flourish",
} satisfies Meta;

export default meta;

/** Seven quick clicks on the mark show who made it. */
export const Logo: StoryObj<typeof LogoMark> = {
  args: { size: 26 },
  render: (args) => <LogoMark {...args} />,
};
