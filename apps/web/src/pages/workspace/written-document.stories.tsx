import type { UserManual } from "@corbits-builder/schemas/artifact";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Share2 } from "lucide-react";
import { expect, fn, waitFor } from "storybook/test";
import { wording } from "../../config.ts";
import { PROBLEM_BRIEF } from "./document-page.stories.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";
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

/** Download and Share beside the contents' heading. */
const files: PaneBarGroup = [
  {
    id: "download",
    label: wording.paneFile.downloadDocument,
    text: wording.paneFile.download,
    icon: <Download aria-hidden="true" />,
    onSelect: fn(),
  },
  {
    id: "share",
    label: wording.paneFile.shareDocument,
    text: wording.paneFile.share,
    icon: <Share2 aria-hidden="true" />,
    onSelect: fn(),
  },
];

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
    title: "Problem brief",
    files,
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

/** A filed document: the page alone, its contents beside it with Download and Share. */
export const Filed: Story = {};

/** An older version read: a note over the page says the plan names the newest. */
export const OlderVersion: Story = {
  args: {
    notes: { ...notes, viewing: 1 },
    body: { kind: "text", source: BRIEF_V1 },
    comments: noComments,
  },
};

/** Another version is being read. */
export const ReadingVersion: Story = {
  args: {
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

/** The app's manual: nothing to download, its pictures where it places them. */
export const UserManualPage: Story = {
  args: {
    title: wording.documentTab["user_manual"] ?? "",
    files: [],
    notes: undefined,
    body: {
      kind: "text",
      source: splitLeadingHeading(SAMPLE_MANUAL.markdown).body,
      images: new Map(Object.entries(SAMPLE_MANUAL.pictures)),
    },
    comments: undefined,
  },
};

/**
 * A passage selected to comment on carries a handle at each end, as a text selection does; dragging
 * the end handle along the line takes in more of it.
 */
export const ResizeAPassage: Story = {
  play: async ({ canvasElement }) => {
    const words = [...canvasElement.querySelectorAll("article p")].find(
      (line) => line.textContent.startsWith("Small bakeries"),
    )?.firstChild;
    if (words === null || words === undefined) throw new Error("No text");
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(words, 0);
    range.setEnd(words, "Small bakeries".length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    words.parentElement?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
    const handle = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>(
        '[data-slot="passage-handle"][data-side="end"]',
      );
      if (found === null) throw new Error("No handle");
      return found;
    });
    const knob = handle.getBoundingClientRect();
    const at = (x: number) => ({
      bubbles: true,
      clientX: x,
      clientY: knob.bottom + 5,
      pointerId: 1,
      isPrimary: true,
    });
    handle.dispatchEvent(new PointerEvent("pointerdown", at(knob.left)));
    window.dispatchEvent(new PointerEvent("pointermove", at(knob.left + 160)));
    window.dispatchEvent(new PointerEvent("pointerup", at(knob.left + 160)));
    await waitFor(() =>
      expect(
        [...(CSS.highlights.get("document-passage-selected") ?? [])].map(
          (passage) => String(passage).length,
        )[0],
      ).toBeGreaterThan("Small bakeries".length),
    );
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
