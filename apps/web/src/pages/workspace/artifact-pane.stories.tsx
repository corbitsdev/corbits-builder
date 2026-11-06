import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ProjectArtifact } from "@corbits-builder/client";
import { useState } from "react";
import { fn } from "storybook/test";
import { ArtifactPane } from "./artifact-pane.tsx";
import type { DeliverableState } from "./deliverable-block.tsx";

const brief: ProjectArtifact = {
  artifactId: "brief",
  kind: "problem_brief",
  title: "Problem brief",
  version: 2,
  sha256: "a".repeat(64),
};

const requirements: ProjectArtifact = {
  artifactId: "requirements",
  kind: "product_requirements",
  title: "Product requirements",
  version: 1,
  sha256: "b".repeat(64),
};

const BRIEF_V1 = `# Problem brief

Small bakeries take cake orders by phone and lose some of them.
`;

const BRIEF_V2 = `# Problem brief

Small bakeries take cake orders by phone and on paper, and lose some of them on busy days.

## Who has it

- Owners who bake and serve at once
- Counter staff who answer the phone mid-shift

## A good Saturday

Every order is in one list, and nobody calls back to ask.
`;

const briefDocument = {
  title: "Problem brief",
  mediaType: "text/markdown",
  content: BRIEF_V2,
  filedAt: "2026-10-30T12:00:00.000Z",
  version: 2,
  sha256: "a".repeat(64),
  before: {
    version: 1,
    content: BRIEF_V1,
    filedAt: "2026-10-30T11:00:00.000Z",
  },
  versions: [
    { version: 2, title: "Problem brief", mediaType: "text/markdown" },
    { version: 1, title: "Problem brief", mediaType: "text/markdown" },
  ],
};

const ready: DeliverableState = { status: "ready", document: briefDocument };

type PaneArgs = {
  deliverables: readonly ProjectArtifact[];
  state: DeliverableState | undefined;
  onAddToPrompt: () => void;
};

// Holds the tab and comparison the pane asks its host to keep.
function Pane({ deliverables, state, onAddToPrompt }: PaneArgs) {
  const [selectedId, setSelectedId] = useState(deliverables[0]?.artifactId);
  const [changesOpen, setChangesOpen] = useState(false);
  const selected =
    deliverables.find((item) => item.artifactId === selectedId) ?? null;
  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <ArtifactPane
        projectTitle="Bakery orders"
        deliverables={deliverables}
        selected={selected}
        state={selected === null ? undefined : state}
        onSelect={setSelectedId}
        changesOpen={changesOpen}
        onToggleChanges={() => setChangesOpen((open) => !open)}
        onRetry={fn()}
        onAddToPrompt={onAddToPrompt}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/DocumentPane",
  parameters: { layout: "fullscreen" },
  args: {
    deliverables: [brief, requirements],
    state: ready,
    onAddToPrompt: fn(),
  },
  render: (args) => <Pane {...args} />,
} satisfies Meta<PaneArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first document, the pane says where documents will appear. */
export const Empty: Story = { args: { deliverables: [] } };

export const Document: Story = {};

export const Loading: Story = { args: { state: { status: "loading" } } };

export const ReadError: Story = {
  args: {
    state: {
      status: "error",
      message: "The document could not be read.",
      retryable: true,
    },
  },
};

/** HTML renders in a sandboxed device frame. */
export const HtmlDesign: Story = {
  args: {
    state: {
      status: "ready",
      document: {
        ...briefDocument,
        mediaType: "text/html",
        content:
          "<h1 style='font-family:system-ui'>Today's orders</h1><p style='font-family:system-ui'>66 orders, 9 for pickup before noon.</p>",
        versions: [],
      },
    },
  },
};
