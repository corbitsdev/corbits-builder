import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import { DocumentContents } from "./document-contents.tsx";

const meta = {
  title: "Components/Workspace/DocumentContents",
  component: DocumentContents,
  args: {
    title: "Problem brief",
    sections: [
      { id: "section-in-short", title: "In short", commented: false },
      { id: "section-who-has-it", title: "Who has it", commented: true },
      {
        id: "section-what-it-must-do",
        title: "What it must do",
        commented: true,
      },
      {
        id: "section-a-good-saturday",
        title: "A good Saturday",
        commented: false,
      },
      {
        id: "section-not-in-the-first-version",
        title: "Not in the first version",
        commented: false,
      },
    ],
    current: "section-who-has-it",
    onOpen: fn(),
  },
  // The contents sit on the room's ground, where the open section is shaded.
  decorators: [
    (Story) => (
      <div style={{ padding: 24, background: "var(--wb-background)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocumentContents>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two sections carry comments; the one being read is lifted. */
export const WithComments: Story = {};

/** At the top of the page no section is open yet. */
export const AtTheTop: Story = { args: { current: null } };

/** The toggle at the head folds the contents away, leaving only itself, and brings them back. */
export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", {
      name: wording.documentViewer.contentsToggle,
    });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("list")).toBeNull();
    await expect(canvas.queryByText("Problem brief")).toBeNull();
    await userEvent.click(toggle);
    await expect(canvas.getByRole("list")).toBeVisible();
  },
};
