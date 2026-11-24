import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Viewport } from "storybook/viewport";
import { SidebarFrame } from "./project-sidebar.view.tsx";
import { RoomFrame } from "./room-frame.tsx";

const viewports = {
  w1920: {
    name: "1920 wide",
    styles: { width: "1920px", height: "1080px" },
    type: "desktop",
  },
  w1440: {
    name: "1440 wide",
    styles: { width: "1440px", height: "900px" },
    type: "desktop",
  },
  w1280: {
    name: "1280 wide",
    styles: { width: "1280px", height: "800px" },
    type: "desktop",
  },
  w1024: {
    name: "1024 wide",
    styles: { width: "1024px", height: "768px" },
    type: "tablet",
  },
  w768: {
    name: "768 wide",
    styles: { width: "768px", height: "1024px" },
    type: "tablet",
  },
} satisfies Record<string, Viewport>;

const box: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  border: "1px dashed var(--wb-border)",
  borderRadius: "var(--radius-lg)",
  background: "var(--wb-muted)",
  color: "var(--wb-muted-foreground)",
  fontSize: "var(--text-sm)",
};

function SidebarList({ rows }: { rows: number }) {
  return (
    <ul
      style={{
        display: "grid",
        gap: "var(--space-1)",
        margin: 0,
        padding: "var(--space-3) var(--space-2)",
        listStyle: "none",
      }}
    >
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} style={{ ...box, height: "2rem" }}>
          Sidebar row {index + 1}
        </li>
      ))}
    </ul>
  );
}

/** The page as a view in the main pane lays itself: its own scroller, edge to edge, its content
 * held to a 48rem column in the pane's middle, with the prompt box at the column's foot. */
function Page({ sections }: { sections: number }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div
        style={{
          display: "grid",
          gap: "var(--space-4)",
          boxSizing: "border-box",
          maxWidth: "48rem",
          minHeight: "100%",
          margin: "0 auto",
          padding: "var(--space-2) var(--space-4) 0",
        }}
      >
        {Array.from({ length: sections }, (_, index) => (
          <div key={index} style={{ ...box, height: "12rem" }}>
            Page section {index + 1}
          </div>
        ))}
        <div
          style={{
            ...box,
            position: "sticky",
            bottom: "var(--space-2)",
            alignSelf: "end",
            height: "7rem",
            borderStyle: "solid",
            background: "var(--wb-background)",
            boxShadow: "var(--wb-shadow)",
          }}
        >
          Prompt box
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Workspace/Room frame",
  component: RoomFrame,
  parameters: { layout: "fullscreen", viewport: { options: viewports } },
  decorators: [
    (Story) => (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    sidebar: null,
    children: <Page sections={3} />,
  },
} satisfies Meta<typeof RoomFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Below 79rem, as the room has it, the sidebar is a drawer. */
function at(
  viewport: keyof typeof viewports,
  {
    sidebarOpen = false,
    sections = 3,
  }: { sidebarOpen?: boolean; sections?: number },
): Story {
  const drawer = viewport === "w1024" || viewport === "w768";
  return {
    args: {
      sidebar: <Sidebar open={sidebarOpen} drawer={drawer} />,
      children: <Page sections={sections} />,
    },
    globals: { viewport: { value: viewport } },
  };
}

/** The sidebar as the room draws it, with stand-in rows for its plan and the rest. */
function Sidebar({ open, drawer }: { open: boolean; drawer: boolean }) {
  return (
    <SidebarFrame
      title="Bakery orders"
      open={open}
      drawer={drawer}
      onToggleSidebar={() => {}}
      onHome={() => {}}
      onSettings={() => {}}
      plan={<SidebarList rows={4} />}
    >
      <SidebarList rows={3} />
    </SidebarFrame>
  );
}

/** Closed or open, the page stands in the same place beside the sidebar's column. */
export const W1920Closed = at("w1920", {});
export const W1920Open = at("w1920", { sidebarOpen: true });

export const W1440Closed = at("w1440", {});
export const W1440Open = at("w1440", { sidebarOpen: true });

export const W1280Open = at("w1280", { sidebarOpen: true });

export const W1024Closed = at("w1024", {});
export const W1024Drawer = at("w1024", { sidebarOpen: true });

export const W768Closed = at("w768", {});
export const W768Drawer = at("w768", { sidebarOpen: true });

/** The page scrolls itself, its scrollbar at the window's edge, under the prompt box. */
export const LongPage = at("w1440", { sidebarOpen: true, sections: 20 });
