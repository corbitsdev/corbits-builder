import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SidebarShell, SidebarSurface } from "./sidebar-shell.tsx";

/** A stand-in for what a slot holds: the given number of rows, named for the slot. */
function Rows({ name, count }: { name: string; count: number }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          style={{
            margin: "2px 0",
            padding: "6px 8px",
            borderRadius: "var(--radius-md)",
            background: "var(--wb-muted)",
            fontSize: "var(--text-xs)",
          }}
        >
          {`${name} ${String(index + 1)}`}
        </li>
      ))}
    </ol>
  );
}

/** Rows in a card of their own, as a page passes them. */
const card = (name: string, count: number, scrolls = true) => (
  <SidebarSurface scrolls={scrolls}>
    <Rows name={name} count={count} />
  </SidebarSurface>
);

const header = (
  <div
    style={{
      height: "2.25rem",
      padding: "0 var(--space-2)",
      display: "flex",
      alignItems: "center",
      fontSize: "var(--text-xs)",
      fontWeight: 600,
    }}
  >
    Header
  </div>
);

const meta = {
  title: "Screens/Workspace/ProjectSidebar/Shell",
  component: SidebarShell,
  parameters: { layout: "fullscreen" },
  args: {
    label: "Sidebar",
    open: true,
    drawer: false,
    header,
    surfaces: card("Plan", 4),
    more: (
      <>
        {card("Files", 4)}
        {card("Section", 2, false)}
      </>
    ),
    onToggle: fn(),
  },
  render: (args) => (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        background: "var(--wb-background)",
      }}
    >
      <SidebarShell {...args} />
    </div>
  ),
} satisfies Meta<typeof SidebarShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All short: each card as tall as what it holds, one under the other, the toggle under the last. */
export const BothShort: Story = {};

/**
 * The card that always shows is tall and those that come in on expanding short: it takes the room
 * they leave and scrolls.
 */
export const TopTall: Story = { args: { surfaces: card("Plan", 40) } };

/** A card that comes in on expanding is tall: the card above keeps what it holds and it scrolls. */
export const BottomTall: Story = {
  args: {
    more: (
      <>
        {card("Files", 40)}
        {card("Section", 2, false)}
      </>
    ),
  },
};

/**
 * Both tall: the card that always shows keeps its share, the files the rest, and each scrolls inside
 * itself; the title, the sections' card and the toggle keep their size.
 */
export const BothTall: Story = {
  args: {
    surfaces: card("Plan", 40),
    more: (
      <>
        {card("Files", 40)}
        {card("Section", 2, false)}
      </>
    ),
  },
};

/** Nothing that always shows: the cards that come in on expanding stand under the title. */
export const NoTop: Story = { args: { surfaces: null } };

/** Collapsed: the title and the card that always shows, with the toggle under them. */
export const Collapsed: Story = { args: { open: false } };

export const CollapsedDark: Story = {
  args: { open: false },
  globals: { mode: "dark" },
};
