import type { UserManual } from "@corbits-builder/schemas/artifact";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download } from "lucide-react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import { PROBLEM_BRIEF } from "./document-page.stories.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";
import { versionGroup } from "./version-menu.tsx";
import {
  WrittenDocumentView,
  type WrittenDocumentViewProps,
} from "./written-document.view.tsx";

const BRIEF = splitLeadingHeading(PROBLEM_BRIEF).body;

/** The brief's first version, before its sections were written. */
const BRIEF_V1 =
  "Small bakeries take cake orders by phone and lose some of them.\n";

const ORDERS_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#faf7f2"/><rect x="24" y="24" width="592" height="48" rx="8" fill="#e98428"/><rect x="24" y="96" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/><rect x="24" y="152" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/><rect x="24" y="208" width="592" height="40" rx="8" fill="#fff" stroke="#ddd"/></svg>',
)}`;

/** The app's manual with a picture of the app as built. */
export const SAMPLE_MANUAL: UserManual = {
  markdown: [
    "# Bakery orders",
    "",
    "## Taking an order",
    "",
    "Press **New order**, type what the customer wants and when they collect it, then press **Save**.",
    "",
    "![The order list on a Saturday](docs/pictures/orders.png)",
    "",
    "## Marking an order collected",
    "",
    "1. Find the order in the list.",
    "2. Press **Collected**.",
  ].join("\n"),
  pictures: { "docs/pictures/orders.png": ORDERS_PICTURE },
};

const download: PaneBarGroup = [
  {
    id: "download",
    label: wording.paneFile.downloadDocument,
    icon: <Download aria-hidden="true" />,
    onSelect: fn(),
  },
];

const approve: PaneBarGroup = [
  {
    id: "approve",
    label: wording.documentApproval.approveLabel(2),
    text: wording.documentApproval.approve(2),
    onSelect: fn(),
  },
];

/** The version menu with versions 1 and 2 kept, reading `viewing`. */
const versions = (viewing: number, pending = false): PaneBarGroup =>
  versionGroup({
    versions: [{ version: 2 }, { version: 1 }],
    viewing,
    pending,
    canCompare: viewing === 2,
    onView: fn(),
    onComparePrevious: fn(),
  });

/** Comments can be written, none yet. */
const noComments = {
  drafts: [],
  onSave: fn(),
  onDelete: fn(),
} satisfies WrittenDocumentViewProps["comments"];

const notes = {
  viewing: 2,
  newest: 2,
  reading: null,
  readError: null,
  readingForComparison: null,
} satisfies WrittenDocumentViewProps["notes"];

const meta = {
  title: "Screens/Workspace/WrittenDocument",
  component: WrittenDocumentView,
  // The pane's story reads the same manual.
  excludeStories: ["SAMPLE_MANUAL"],
  parameters: { layout: "fullscreen" },
  args: {
    project: "Bakery orders",
    title: "Problem brief",
    meta: wording.documentViewer.filedOn("2026-11-18T10:00:00.000Z"),
    groups: [approve, versions(2), download],
    notes,
    body: { kind: "text", source: BRIEF },
    comments: noComments,
  },
  decorators: [
    (Story) => (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WrittenDocumentView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The newest version, waiting to be approved: Approve, the versions and the download head the page. */
export const Filed: Story = {};

/** Once approved, the bar says so in place of Approve. */
export const Approved: Story = {
  args: {
    groups: [
      [
        {
          id: "approved",
          label: wording.documentApproval.approvedLabel(
            2,
            "2026-11-19T09:00:00.000Z",
          ),
          text: wording.documentApproval.approved(2),
          note: true,
        },
      ],
      versions(2),
      download,
    ],
  },
};

/** An older version read from the menu: a note over the page says the plan names the newest. */
export const OlderVersion: Story = {
  args: {
    meta: wording.documentViewer.filedOn("2026-11-17T10:00:00.000Z"),
    groups: [versions(1), download],
    notes: { ...notes, viewing: 1 },
    body: { kind: "text", source: BRIEF_V1 },
    comments: noComments,
  },
};

/** A version picked from the menu is being read; the menu waits for it. */
export const ReadingVersion: Story = {
  args: {
    groups: [approve, versions(2, true), download],
    notes: { ...notes, reading: 1 },
  },
};

/** The version picked could not be read: the error line sits over the page still on show. */
export const VersionReadFailed: Story = {
  args: {
    notes: { ...notes, readError: "The document could not be read." },
  },
};

/** The room could not list the document's versions, so only the newest is offered. */
export const HistoryUnavailable: Story = {
  args: {
    groups: [approve, download],
    notes: { ...notes, historyError: "The hub did not answer." },
  },
};

/** Compared with the version before: the page shows the changes, tracked inline. */
export const Comparing: Story = {
  args: {
    body: {
      kind: "comparison",
      before: BRIEF_V1,
      after: BRIEF,
      beforeVersion: 1,
      afterVersion: 2,
      onClose: fn(),
    },
  },
};

/** An approaches document puts its filed approaches above its text, to choose from. */
export const Approaches: Story = {
  args: {
    title: "Approaches",
    body: {
      kind: "text",
      source:
        "Two ways to take orders online, compared for a bakery of three.\n\n## Why these two\n\nBoth run without a developer on hand.\n",
      approaches: {
        meta: {
          recommended: "form",
          approaches: [
            {
              id: "form",
              name: "An order form",
              summary: "A page with one form that emails each order.",
              bestFor: "A bakery that wants orders online this week",
              pros: ["Live in a day", "Nothing to learn"],
              cons: ["Orders arrive as emails"],
              effort: "low",
              risks: [],
            },
            {
              id: "shop",
              name: "A small shop",
              summary: "A shop with a cake list, a basket and a deposit.",
              bestFor: "A bakery ready to take deposits",
              pros: ["Takes deposits", "One list of orders"],
              cons: ["Weeks to set up", "A monthly fee"],
              effort: "high",
              risks: ["Card fees on small orders"],
            },
          ],
        },
        chosen: undefined,
        onChoose: fn(async () => null),
      },
    },
    comments: noComments,
  },
};

/** The app's manual: no versions to pick and nothing to approve, its pictures where it places them. */
export const UserManualPage: Story = {
  args: {
    title: wording.documentTab["user_manual"] ?? "",
    meta: wording.documentViewer.asBuilt,
    groups: [],
    notes: undefined,
    body: {
      kind: "text",
      source: splitLeadingHeading(SAMPLE_MANUAL.markdown).body,
      images: new Map(Object.entries(SAMPLE_MANUAL.pictures)),
    },
    comments: undefined,
  },
};

export const Dark: Story = { globals: { mode: "dark" } };

export const DarkOlderVersion: Story = {
  args: { ...OlderVersion.args },
  globals: { mode: "dark" },
};

/** At phone width the contents give way and the page fills the width. */
export const Narrow: Story = {
  globals: { viewport: { value: "mobile1" } },
  decorators: [
    (Story) => (
      <div style={{ width: 375, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
};
