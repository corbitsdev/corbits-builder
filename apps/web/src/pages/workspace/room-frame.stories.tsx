import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Viewport } from "storybook/viewport";
import { Mark } from "../../components.tsx";
import {
  RoomFrame,
  type RoomFrameProps,
  type RoomFrameSide,
} from "./room-frame.tsx";

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

/** As the home page draws the product's mark: 22px, 8px from the row's start. */
function TitlePill() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: "100%",
        padding: "0 var(--space-3) 0 var(--space-2)",
        borderRadius: "var(--radius-lg)",
        background: "var(--card)",
        fontWeight: 600,
      }}
    >
      <Mark size={22} />
      <span>Bakery orders</span>
    </div>
  );
}

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

function Page({ sections }: { sections: number }) {
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {Array.from({ length: sections }, (_, index) => (
        <div key={index} style={{ ...box, height: "12rem" }}>
          Page section {index + 1}
        </div>
      ))}
    </div>
  );
}

function PromptBox() {
  return (
    <div
      style={{
        ...box,
        height: "7rem",
        borderStyle: "solid",
        background: "var(--wb-background)",
        boxShadow: "var(--wb-shadow)",
      }}
    >
      Prompt box
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
  args: {
    title: <TitlePill />,
    sidebar: <SidebarList />,
    sidebarOpen: false,
    side: { state: "empty" },
    prompt: <PromptBox />,
    children: <Page sections={3} />,
  },
} satisfies Meta<typeof RoomFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

function at(
  viewport: keyof typeof viewports,
  args: Partial<RoomFrameProps>,
): Story {
  return { args, globals: { viewport: { value: viewport } } };
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

/** The window scrolls the page, its scrollbar at the window's edge, under the prompt box. */
export const LongPage = at("w1440", {
  sidebarOpen: true,
  side: showing,
  children: <Page sections={20} />,
});
