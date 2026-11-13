import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import { APPROVAL_PACKAGE_MEDIA_TYPE } from "./approval-package.ts";
import approvalRounds, {
  InDocumentTab as roundsInTab,
} from "./approval-rounds.stories.tsx";
import { ApprovalRoundsView } from "./approval-rounds.view.tsx";
import {
  ArtifactPane,
  type ArtifactPaneProps,
  type PaneDocument,
} from "./artifact-pane.tsx";
import type { DeliverableState } from "./deliverable-block.tsx";
import designConcept from "./design-concepts.stories.tsx";
import { ConceptMockupView } from "./design-concepts.view.tsx";
import liveApp from "./live-app.stories.tsx";
import { LiveAppView } from "./live-app.view.tsx";
import { TweakPanelView } from "./mockup-tweaks.view.tsx";
import { sampleDesign, sampleDraft } from "./sample-design.ts";
import { WithPictures as manual } from "./user-manual.stories.tsx";

const brief: PaneDocument = {
  id: "problem_brief",
  title: "Problem brief",
  status: wording.documentStatus.approved(2),
  unread: false,
  removable: false,
};

// Filed since the person last looked, so its tab is marked.
const requirements: PaneDocument = {
  id: "product_requirements",
  title: "Product requirements",
  status: wording.documentStatus.drafted(1),
  unread: true,
  removable: false,
};

const plan: PaneDocument = {
  id: "build_plan",
  title: "Build plan",
  status: wording.documentStatus.drafted(1),
  unread: false,
  removable: false,
};

const approvalPackage: PaneDocument = {
  id: "approval_package",
  title: "Approval package",
  status: wording.documentStatus.drafted(1),
  unread: false,
  removable: false,
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

// Holds the document the pane reads, which it asks its host to keep; the story names the first.
function Pane(args: ArtifactPaneProps) {
  const [selectedId, setSelectedId] = useState(args.selectedId);
  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <ArtifactPane
        {...args}
        selectedId={selectedId}
        state={selectedId === null ? undefined : args.state}
        onSelect={setSelectedId}
      />
    </div>
  );
}

const onSave = fn();

const meta = {
  title: "Screens/Workspace/DocumentPane",
  component: ArtifactPane,
  parameters: { layout: "fullscreen" },
  args: {
    projectTitle: "Bakery orders",
    concepts: [],
    documents: [brief, requirements],
    selectedId: brief.id,
    state: ready,
    onSelect: fn(),
    onSeen: fn(),
    open: true,
    onClose: fn(),
    onRetry: fn(),
    onAddToPrompt: fn(),
    conceptMockup: (concept, frame) => (
      <ConceptMockupView
        {...designConcept.args}
        label={concept.label}
        {...frame}
      />
    ),
    // The bar's Add new reviewer opens the rounds' own form.
    approvalRounds: ({ shareOpen, onShareOpenChange }) => (
      <ApprovalRoundsView
        {...approvalRounds.args}
        {...roundsInTab.args}
        addingReviewer={shareOpen}
        onAddingReviewerChange={onShareOpenChange}
      />
    ),
    tweakPanel: (panel) => (
      <TweakPanelView {...panel} onSave={onSave} saving={false} />
    ),
  },
  render: (args) => <Pane {...args} />,
} satisfies Meta<typeof ArtifactPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first document, the pane says where documents will appear. */
export const Empty: Story = { args: { documents: [], selectedId: null } };

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

/** The live designer's unfiled mockup has a tab of its own until a design is filed. */
export const DesignDraft: Story = {
  args: { documents: [], selectedId: null, draft: sampleDraft },
};

/** Each design concept the person compares is a tab of its own. */
export const Concepts: Story = {
  args: {
    concepts: ["Paper", "Quiet"].map((label) => ({
      label,
      content: JSON.stringify(sampleDesign),
    })),
  },
};

/** Once a build plan is filed, the app it builds and its manual sit beside the plan. */
export const AppAndManual: Story = {
  args: {
    ...manual.args,
    documents: [brief, plan],
    liveApp: <LiveAppView {...liveApp.args} />,
  },
};

/** An approval package's tab is its rounds: who was asked to sign off and what each decided. */
export const ApprovalPackage: Story = {
  args: {
    documents: [brief, approvalPackage],
    selectedId: approvalPackage.id,
    state: {
      status: "ready",
      document: {
        ...briefDocument,
        title: approvalPackage.title,
        mediaType: APPROVAL_PACKAGE_MEDIA_TYPE,
        content: "{}",
        version: 1,
        before: null,
        versions: [],
      },
    },
  },
};
