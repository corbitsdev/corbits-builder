import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  FilesList,
  type FilesListProps,
  type SidebarFile,
} from "./files-list.tsx";

const words = wording.projectShell;

/** A file that opens on its own tab. */
const file = (id: string, name: string): SidebarFile => ({
  id,
  name,
  opens: id,
  files: [],
});

/** A row that only groups files under it: an uploaded folder, or the designs where there are many. */
const group = (
  id: string,
  name: string,
  files: readonly SidebarFile[],
): SidebarFile => ({ id, name, opens: null, files });

const mockup = file("design_mockup", wording.design.mockupTab);
const concept = (label: string) =>
  file(`concept_${label}`, wording.design.conceptTitle(label));

export const smallFiles = [
  file("problem_brief", "Brief"),
  file("constraints", "Constraints"),
  file("product_requirements", "Requirements"),
];

/** One design and its mockup stand as plain rows beside the rest. */
export const finishedFiles = [
  file("problem_brief", "Brief"),
  file("product_requirements", "Requirements"),
  file("design", "Design"),
  mockup,
  file("build_plan", "Build plan"),
  file("user_manual", "User manual"),
];

/** Five design files gather under one Designs row; each uploaded folder holds its files. */
export const largeFiles = [
  file("problem_brief", "Brief"),
  file("constraints", "Constraints"),
  file("approaches", "Approaches"),
  file("product_requirements", "Requirements"),
  group("designs", "Designs", [
    file("design", "Design"),
    mockup,
    concept("Retro"),
    concept("Market stall"),
    concept("Clean"),
  ]),
  file("build_plan", "Build plan"),
  file("user_manual", "User manual"),
  file("approval_package", "Approval"),
  group("photos", "Cake photos", [
    file("photos/birthday.jpg", "birthday.jpg"),
    file("photos/wedding.jpg", "wedding.jpg"),
    file("photos/cupcakes.jpg", "cupcakes.jpg"),
    file("photos/sourdough.jpg", "sourdough.jpg"),
  ]),
  group("suppliers", "Supplier price lists", [
    file("suppliers/flour.pdf", "flour.pdf"),
    file("suppliers/dairy.pdf", "dairy.pdf"),
    file("suppliers/packaging.pdf", "packaging.pdf"),
  ]),
  file("menu.pdf", "menu.pdf"),
  file("opening-hours.txt", "opening-hours.txt"),
];

export const longNamedFiles = [
  file("problem_brief", "Brief"),
  group("orders", "Wholesale orders from cafés and restaurants, spring", [
    file(
      "orders/standing.xlsx",
      "standing-orders-for-the-saturday-market-and-weekday-deliveries.xlsx",
    ),
  ]),
  file(
    "allergens.pdf",
    "allergen-information-for-every-cake-and-loaf-we-sell.pdf",
  ),
];

// Holds what the page would: the file opened from the list, so a story can be clicked through.
function Clickable(args: FilesListProps) {
  const [shown, setShown] = useState(args.shown);
  return (
    <FilesList
      {...args}
      shown={shown}
      onOpen={(tab) => {
        setShown(tab);
        args.onOpen(tab);
      }}
    />
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar/Files",
  component: FilesList,
  args: { files: smallFiles, shown: null, onOpen: fn() },
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
} satisfies Meta<typeof FilesList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Until the project has a file there is no Files group. */
export const NoFiles: Story = {
  args: { files: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("button", { name: words.files }),
    ).toBeNull();
  },
};

/**
 * A small project: its first files, named for what they are. A row opens its file and is marked
 * while it is on the page.
 */
export const Small: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const requirements = canvas.getByRole("treeitem", {
      name: "Requirements",
    });
    await userEvent.click(requirements);
    await expect(args.onOpen).toHaveBeenCalledWith("product_requirements");
    await expect(requirements).toHaveAttribute("aria-current", "page");
  },
};

/** A finished project: the design and its mockup are plain rows, and no row has an arrow. */
export const Finished: Story = {
  args: { files: finishedFiles, shown: "build_plan" },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole("treeitem");
    await expect(rows.map((row) => row.getAttribute("aria-level"))).toEqual(
      finishedFiles.map(() => "1"),
    );
    await expect(
      rows.filter((row) => row.hasAttribute("aria-expanded")),
    ).toHaveLength(0);
  },
};

export const FinishedDark: Story = {
  ...Finished,
  globals: { mode: "dark" },
};

/**
 * A large project: more files than fit beside the plan, so the group starts folded. Opened, the
 * designs gather under one row and each uploaded folder holds its files, each folding from its
 * arrow or the keyboard.
 */
export const Large: Story = {
  args: { files: largeFiles },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("tree", { name: words.files })).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: words.files, expanded: false }),
    );
    await expect(canvas.getByRole("tree", { name: words.files })).toBeVisible();
    const photos = canvas.getByRole("treeitem", { name: "Cake photos" });
    await expect(
      within(photos)
        .getAllByRole("treeitem")
        .map((item) => item.getAttribute("aria-level")),
    ).toEqual(["2", "2", "2", "2"]);
    const designs = canvas.getByRole("treeitem", { name: "Designs" });
    await expect(within(designs).getAllByRole("treeitem")).toHaveLength(5);
    designs.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(designs).toHaveAttribute("aria-expanded", "false");
    await expect(within(designs).queryAllByRole("treeitem")).toHaveLength(0);
  },
};

/** Long file and folder names are cut short with an ellipsis, nested ones too. */
export const LongNames: Story = { args: { files: longNamedFiles } };

/** The icons switched off: the chevron's space and the names alone. */
export const NoIcons: Story = {
  args: { files: largeFiles, icons: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: words.files, expanded: false }),
    );
    await expect(
      canvas.getByRole("treeitem", { name: "Brief" }).querySelector("svg"),
    ).toBeNull();
  },
};
