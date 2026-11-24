import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Viewport } from "storybook/viewport";
import { SidebarFrame } from "./project-sidebar.view.tsx";
import { RoomFrame, type RoomFrameSide } from "./room-frame.tsx";

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

function SidebarList() {
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
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} style={{ ...box, height: "2rem" }}>
          Sidebar row {index + 1}
        </li>
      ))}
    </ul>
  );
}

/** The page as a view in the main pane lays itself: its own scroller, edge to edge, its content
 * held to the frame's column, with the prompt box at the column's foot. */
function Page({ sections }: { sections: number }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div
        style={{
          display: "grid",
          gap: "var(--space-4)",
          boxSizing: "border-box",
          maxWidth: "var(--frame-column)",
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

const showing: RoomFrameSide = {
  state: "showing",
  content: (
    <div style={{ ...box, height: "100%", border: 0 }}>Plugin screen</div>
  ),
};

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
    side: { state: "empty" },
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
    side = { state: "empty" },
    sections = 3,
  }: { sidebarOpen?: boolean; side?: RoomFrameSide; sections?: number },
): Story {
  const drawer = viewport === "w1024" || viewport === "w768";
  return {
    args: {
      sidebar: <Sidebar open={sidebarOpen} drawer={drawer} />,
      side,
      children: <Page sections={sections} />,
    },
    globals: { viewport: { value: viewport } },
  };
}

/** The sidebar as the room draws it, with stand-in rows. */
function Sidebar({ open, drawer }: { open: boolean; drawer: boolean }) {
  return (
    <SidebarFrame
      title="Bakery orders"
      open={open}
      drawer={drawer}
      onToggleSidebar={() => {}}
    >
      <SidebarList />
    </SidebarFrame>
  );
}

export const W1920TitleOnly = at("w1920", { side: showing });
export const W1920SidebarOpen = at("w1920", {
  sidebarOpen: true,
  side: showing,
});
export const W1920SideEmpty = at("w1920", { sidebarOpen: true });
export const W1920SideHidden = at("w1920", { side: { state: "hidden" } });

export const W1440TitleOnly = at("w1440", { side: showing });
export const W1440SidebarOpen = at("w1440", {
  sidebarOpen: true,
  side: showing,
});
export const W1440SideEmpty = at("w1440", { sidebarOpen: true });
export const W1440SideHidden = at("w1440", {
  sidebarOpen: true,
  side: { state: "hidden" },
});

/** The sidebar still fits beside the column; the plugin screen opens over the page. */
export const W1280SidebarOpen = at("w1280", {
  sidebarOpen: true,
  side: showing,
});
export const W1280SideHidden = at("w1280", { side: { state: "hidden" } });

export const W1024TitleOnly = at("w1024", {});
export const W1024Drawer = at("w1024", { sidebarOpen: true });
export const W1024Sheet = at("w1024", { side: showing });

export const W768TitleOnly = at("w768", {});
export const W768Drawer = at("w768", { sidebarOpen: true });
export const W768Sheet = at("w768", { side: showing });

/** The page scrolls itself, its scrollbar at the window's edge, under the prompt box. */
export const LongPage = at("w1440", {
  sidebarOpen: true,
  side: showing,
  sections: 20,
});
