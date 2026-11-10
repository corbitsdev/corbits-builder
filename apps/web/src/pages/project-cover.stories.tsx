import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { fn } from "storybook/test";
import { ProjectCoverView } from "./project-cover.view.tsx";

const MOCKUP = `<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;background:#fbf7f1;color:#2b2118">
    <header style="padding:32px 48px;border-bottom:1px solid #e5dccf">
      <strong style="font-size:28px">Northside Bakery</strong>
    </header>
    <main style="padding:48px">
      <h1 style="font-size:56px;margin:0 0 16px">Saturday orders</h1>
      <p style="font-size:24px;margin:0">14 to bake, 3 to collect before noon.</p>
    </main>
  </body>
</html>`;

const meta = {
  title: "Screens/Projects/Cover",
  component: ProjectCoverView,
  args: {
    pattern: "linear",
    style: {
      "--cover-a": "var(--chart-1)",
      "--cover-b": "var(--chart-4)",
      "--cover-angle": "135deg",
      "--cover-x": "30%",
      "--cover-y": "40%",
    } as CSSProperties,
    mockup: null,
    onNear: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProjectCoverView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linear: Story = {};
export const Radial: Story = { args: { pattern: "radial" } };
export const Stripes: Story = { args: { pattern: "stripes" } };
export const Rings: Story = { args: { pattern: "rings" } };
export const Mesh: Story = { args: { pattern: "mesh" } };

/** The first page of the project's design, as a still picture. */
export const Mockup: Story = { args: { mockup: MOCKUP } };
