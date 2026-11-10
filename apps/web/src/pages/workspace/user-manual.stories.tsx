import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserManualView } from "./user-manual.view.tsx";

const ORDERS_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#faf7f2"/><rect x="24" y="24" width="592" height="48" rx="8" fill="#e98428"/><rect x="24" y="96" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/><rect x="24" y="152" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/><rect x="24" y="208" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/></svg>',
)}`;

const meta = {
  title: "Screens/Workspace/UserManual",
  component: UserManualView,
} satisfies Meta<typeof UserManualView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithPictures: Story = {
  args: {
    manual: {
      markdown: [
        "# Bakery orders",
        "",
        "## Taking an order",
        "",
        "Press **New order**, type what the customer wants and when they collect it, then press **Save**.",
        "",
        "![The order list on a Saturday](docs/pictures/orders.png)",
        "",
        "## Marking an order collected",
        "",
        "1. Find the order in the list.",
        "2. Press **Collected**.",
      ].join("\n"),
      pictures: { "docs/pictures/orders.png": ORDERS_PICTURE },
    },
  },
};

/** The coder has written the manual but check-app has saved no pictures yet. */
export const WordsOnly: Story = {
  args: {
    manual: {
      markdown: [
        "# Bakery orders",
        "",
        "## Taking an order",
        "",
        "Press **New order**, type what the customer wants and when they collect it, then press **Save**.",
      ].join("\n"),
      pictures: {},
    },
  },
};
