import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SidebarShell } from "./sidebar-shell.tsx";

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

const header = (
  <div
    style={{
      height: "2.5rem",
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
    bottomId: "sidebar-bottom",
    header,
    top: <Rows name="Top" count={4} />,
    bottom: <Rows name="Bottom" count={4} />,
    onPutAway: fn(),
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

/** Both short: each as tall as what it holds, one under the other. */
export const BothShort: Story = {};

/** The top is tall and the bottom short: the top takes the room the bottom leaves and scrolls. */
export const TopTall: Story = { args: { top: <Rows name="Top" count={40} /> } };

/** The bottom is tall and the top short: the top keeps what it holds and the bottom scrolls. */
export const BottomTall: Story = {
  args: { bottom: <Rows name="Bottom" count={40} /> },
};

/** Both tall: the top keeps its share, the bottom the rest, and each scrolls inside itself. */
export const BothTall: Story = {
  args: {
    top: <Rows name="Top" count={40} />,
    bottom: <Rows name="Bottom" count={40} />,
  },
};

/** No top: the bottom stands under the header and the empty slot takes no room. */
export const NoTop: Story = { args: { top: null } };

/** Closed: the header and the top alone; the bottom waits until the sidebar opens. */
export const Collapsed: Story = { args: { open: false } };
