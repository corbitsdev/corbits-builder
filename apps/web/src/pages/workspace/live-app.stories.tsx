import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download } from "lucide-react";
import { fn } from "storybook/test";
import {
  BuilderSetupView,
  LiveAppView,
  type LiveAppViewProps,
} from "./live-app.view.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";

const APP_URL = `data:text/html,${encodeURIComponent(
  '<body style="font-family: system-ui; margin: 0; padding: 24px"><h1>Saturday orders</h1><ul><li>Lemon cake, collect 2pm</li><li>Sourdough x4, collect 9am</li></ul></body>',
)}`;

const CHECKLIST = `# Acceptance checklist

Checked against the running app after each change.

- [x] AC-1: A phone order can be added in under a minute
  Added "Lemon cake, 2pm" from the New order screen in 20 seconds.
  - [x] The form keeps what was typed when a field is missing
- [x] AC-2: Saturday's orders are listed soonest collection first
- [ ] AC-3: An order can be marked collected
- [ ] AC-4: The list still opens without a connection`;

const LOG = [
  "$ bun install",
  "148 packages installed [2.31s]",
  "$ bun run dev",
  "error: Cannot find module './routes/orders' from 'src/server.ts'",
];

const files: PaneBarGroup = [
  {
    id: "download",
    label: "Download the code",
    icon: <Download size={16} aria-hidden="true" />,
    onSelect: fn(),
  },
];

const args: LiveAppViewProps = {
  app: { state: "running", url: APP_URL },
  builderStatus: { phrase: "Writing the order list" },
  demoLogin: undefined,
  checklist: null,
  files,
  builderSetup: (
    <BuilderSetupView
      doing="Writing the order list"
      progress="12 files written · last: orders · 20 s ago"
      // Recent enough that the sketch's clock reads a few minutes.
      since={new Date(Date.now() - 3 * 60_000).toISOString()}
    />
  ),
};

const meta = {
  title: "Screens/Workspace/LiveApp",
  component: LiveAppView,
  parameters: { layout: "fullscreen" },
  args,
  decorators: [
    (Story) => (
      <div style={{ height: 640, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiveAppView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

/** The bar notes the demo account the app seeds and opens the Builder's checklist over itself. */
export const RunningWithChecklist: Story = {
  args: {
    demoLogin: { email: "demo@bakery.test", password: "demo-orders" },
    checklist: CHECKLIST,
  },
};

/** Before the hub has said where the app stands, nothing is drawn. */
export const Loading: Story = {
  args: { app: { state: "loading" }, files: [] },
};

export const NotBuilt: Story = {
  args: { app: { state: "not_built" }, files: [], builderStatus: null },
};

/** Nothing is built yet, but an coder is at work, so what it is doing shows. */
export const NotBuiltWhileBuilding: Story = {
  args: { app: { state: "not_built" }, files: [] },
};

export const Installing: Story = {
  args: {
    app: {
      state: "starting",
      phase: "installing",
      version: undefined,
      fromBuilder: true,
      log: LOG.slice(0, 2),
    },
  },
};

/** A filed version starting, named under the state. */
export const Starting: Story = {
  args: {
    app: {
      state: "starting",
      phase: "starting",
      version: "App v3",
      fromBuilder: false,
      log: LOG.slice(0, 3),
    },
    checklist: CHECKLIST,
  },
};

export const Stopped: Story = {
  args: { app: { state: "stopped" } },
};

/** The hub's own reason, with the app's last output to open under it. */
export const Failed: Story = {
  args: {
    app: {
      state: "failed",
      error: "The app stopped while starting.",
      log: LOG,
    },
  },
};

export const FailedWithoutReason: Story = {
  args: { app: { state: "failed", error: undefined, log: undefined } },
};

/** This Builder cannot run apps at all. */
export const Unavailable: Story = {
  args: { app: { state: "unavailable" }, files: [] },
};

/** The hub could not read the project's saved app. */
export const Refused: Story = {
  args: {
    app: {
      state: "refused",
      reason: "Builder cannot read this project's saved app right now.",
    },
    files: [],
  },
};

/** The coder is writing the project's first app. */
export const SettingUp: Story = {
  args: { app: { state: "setting_up", url: undefined } },
};

/** The starter answers, but is held back while the coder's progress is being read. */
export const StarterHeldWhileChecking: Story = {
  args: { app: { state: "held", url: APP_URL, builder: "checking" } },
};

export const StarterHeldProgressUnknown: Story = {
  args: { app: { state: "held", url: APP_URL, builder: "unknown" } },
};

/** The coder is idle and has written none of the app yet. */
export const StarterHeldNothingWritten: Story = {
  args: { app: { state: "held", url: APP_URL, builder: "idle" } },
};
