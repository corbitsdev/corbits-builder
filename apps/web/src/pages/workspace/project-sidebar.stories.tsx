import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import { WorkspaceMenuView } from "../../workspace-menu.view.tsx";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
  type SidebarDocument,
  type SidebarDocumentState,
  type SidebarStep,
} from "./project-sidebar.view.tsx";

const tab = wording.documentTab;
const stepName = { plan: "Plan", design: "Design", build: "Build" };

const doc = (
  id: string,
  state: SidebarDocumentState = "ready",
  name: string = tab[id] ?? id,
): SidebarDocument => ({ id, name, state });

const step = (
  id: keyof typeof stepName,
  documents: readonly SidebarDocument[],
  open = documents.length > 0,
): SidebarStep => ({ id, name: stepName[id], documents, open });

/** Design and Build, before either has started. */
const notStarted = [step("design", []), step("build", [])];

const planning: SidebarStep[] = [
  step("plan", [
    doc("problem_brief"),
    doc("constraints"),
    doc("approaches", "writing"),
  ]),
  ...notStarted,
];

const building: SidebarStep[] = [
  step(
    "plan",
    [
      doc("problem_brief"),
      doc("constraints"),
      doc("approaches"),
      doc("product_requirements"),
      doc("build_plan"),
    ],
    false,
  ),
  step("design", [doc("design")]),
  step("build", [doc("app"), doc("user_manual", "writing")]),
];

// Holds what the page would: which steps are open, the document on the page and whether the
// sidebar is out, so a story can be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [steps, setSteps] = useState(args.steps);
  const [selected, setSelected] = useState(args.selectedDocument);
  const [open, setOpen] = useState(args.open);
  const [liveApp, setLiveApp] = useState(args.liveApp);
  return (
    <ProjectSidebarView
      {...args}
      steps={steps}
      selectedDocument={selected}
      open={open}
      liveApp={liveApp}
      onToggleSidebar={() => {
        setOpen(!open);
        args.onToggleSidebar();
      }}
      onToggleStep={(stepId) => {
        setSteps(
          steps.map((each) =>
            each.id === stepId ? { ...each, open: !each.open } : each,
          ),
        );
        args.onToggleStep(stepId);
      }}
      onOpenDocument={(documentId) => {
        setSelected(documentId);
        args.onOpenDocument(documentId);
      }}
      onToggleLiveApp={(running) => {
        setLiveApp({ running: !running, changing: true });
        setTimeout(() => setLiveApp({ running, changing: false }), 1200);
        args.onToggleLiveApp(running);
      }}
    />
  );
}

const workspaceMenu = (name: string) => (
  <WorkspaceMenuView
    name={name}
    workspaces={[{ id: "bakery", name, open: true }]}
    onOpen={fn()}
    onCreate={fn()}
  />
);

/** The sidebar stands on the project's ground at the window's full height, beside an empty page. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        background: "var(--card)",
      }}
    >
      {children}
      <div
        style={{
          flex: 1,
          margin: 8,
          borderRadius: "var(--radius-lg)",
          background: "var(--wb-pane)",
          boxShadow: "var(--wb-pane-shadow)",
        }}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar",
  component: ProjectSidebarView,
  parameters: { layout: "fullscreen" },
  args: {
    project: "Bakery orders",
    open: true,
    drawer: false,
    steps: planning,
    selectedDocument: "problem_brief",
    liveApp: null,
    workspaceMenu: workspaceMenu("Bakery Co."),
    onToggleSidebar: fn(),
    onToggleStep: fn(),
    onOpenDocument: fn(),
    onToggleLiveApp: fn(),
    onProjectSettings: fn(),
    onSecrets: fn(),
    onAllProjects: fn(),
    onNewProject: fn(),
  },
  render: (args) => (
    <Shell>
      <Clickable {...args} />
    </Shell>
  ),
} satisfies Meta<typeof ProjectSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** While planning: Plan lists its documents as they are written; Design and Build have not started. */
export const Planning: Story = {};

const buildingArgs = {
  steps: building,
  selectedDocument: "app",
  liveApp: { running: true, changing: false },
};

/** While building: Plan is folded; Design and Build are open, and the app runs. */
export const Building: Story = { args: buildingArgs };

/** A new project: every step is named, none has started, and there is no app yet. */
export const NewProject: Story = {
  args: {
    steps: [step("plan", []), ...notStarted],
    selectedDocument: null,
  },
};

/** Every state a document row takes: ready, open, waiting on the person, being written, failed. */
export const DocumentStates: Story = {
  args: {
    steps: [
      step("plan", [
        doc("problem_brief"),
        doc("constraints"),
        doc("approaches", "needs_you"),
        doc("product_requirements", "writing"),
        doc("build_plan", "failed"),
      ]),
      ...notStarted,
    ],
    selectedDocument: "constraints",
  },
};

/** A long document and project name are cut short with an ellipsis rather than wrapping. */
export const LongNames: Story = {
  args: {
    project: "Bakery orders and wholesale delivery scheduling",
    workspaceMenu: workspaceMenu("Bakery Co. North-West Regional Operations"),
    steps: [
      step("plan", [
        doc("problem_brief"),
        doc(
          "notes",
          "needs_you",
          "Interview notes from the Saturday market stall owners",
        ),
        doc(
          "pricing",
          "ready",
          "Wholesale pricing tiers for cafés and restaurants",
        ),
      ]),
      ...notStarted,
    ],
    selectedDocument: "pricing",
  },
};

/** The app is stopped: the switch is off. */
export const LiveAppStopped: Story = {
  args: { ...buildingArgs, liveApp: { running: false, changing: false } },
};

/** A start is on its way: the switch holds until it lands. */
export const LiveAppStarting: Story = {
  args: { ...buildingArgs, liveApp: { running: false, changing: true } },
};

/**
 * Closed, the page takes the whole window; only the project's name floats top left, as the control
 * that opens the sidebar again.
 */
export const Closed: Story = { args: { ...buildingArgs, open: false } };

/**
 * The steps and documents are one tree with one tab stop, which lands on the open document. The
 * arrows move between rows; Left steps out to the step and then folds it.
 */
export const Keyboard: Story = {
  args: buildingArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const app = canvas.getByRole("treeitem", { name: "App" });
    while (document.activeElement !== app) await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: /^User manual/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    const build = canvas.getByRole("treeitem", { name: /^Build/ });
    await expect(build).toHaveFocus();
    await expect(build).toHaveAttribute("aria-expanded", "false");
  },
};

/** In a narrow room the sidebar is a drawer over the page. */
export const Drawer: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1" },
};
