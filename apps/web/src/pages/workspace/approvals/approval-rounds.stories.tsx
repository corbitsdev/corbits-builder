import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ApprovalRoundsView,
  type ApprovalRoundsViewProps,
  type Finding,
  type PackageFile,
  type Reviewer,
  type Round,
} from "./approval-rounds.view.tsx";
import shareForm from "./share-package.stories.tsx";
import { SharePackageView } from "./share-package.view.tsx";

// Holds what the panel asks its host to keep: what is typed in a drawer, the files ticked for a
// download, and which dialog is open.
function Panel(args: ApprovalRoundsViewProps) {
  const [rounds, setRounds] = useState(args.rounds);
  const [addingReviewer, setAddingReviewer] = useState(args.addingReviewer);
  const change = (id: string, next: (reviewer: Reviewer) => Reviewer) =>
    setRounds((current) =>
      current.map((round) => ({
        ...round,
        reviewers: round.reviewers.map((reviewer) =>
          reviewer.id === id ? next(reviewer) : reviewer,
        ),
      })),
    );
  const held = (reviewer: Reviewer): Reviewer => {
    const setDownloadOpen = (open: boolean) =>
      change(reviewer.id, (current) => ({
        ...current,
        download: { ...current.download, open },
      }));
    return {
      ...reviewer,
      onEdit: (fields) =>
        change(reviewer.id, (current) => ({
          ...current,
          fields: { ...current.fields, ...fields },
          unsaved: {
            ...current.unsaved,
            ...Object.fromEntries(
              Object.keys(fields).map((key) => [key, true]),
            ),
          },
        })),
      download: {
        ...reviewer.download,
        onOpen: () => setDownloadOpen(true),
        onOpenChange: setDownloadOpen,
        onToggleFile: (path) =>
          change(reviewer.id, (current) => ({
            ...current,
            download: {
              ...current.download,
              files: current.download.files.map((file) =>
                file.path === path
                  ? { ...file, included: !file.included }
                  : file,
              ),
            },
          })),
      },
    };
  };
  return (
    <ApprovalRoundsView
      {...args}
      rounds={rounds.map((round) => ({
        ...round,
        reviewers: round.reviewers.map(held),
      }))}
      addingReviewer={addingReviewer}
      onAddingReviewerChange={setAddingReviewer}
    />
  );
}

const deck = {
  theme: {
    colors: {
      primary: "#1e293b",
      secondary: "#334155",
      accent: "#e98428",
      background: "#ffffff",
      text: "#0f172a",
      muted: "#64748b",
    },
    fonts: { heading: "Inter", body: "Inter" },
  },
  slides: [
    {
      layout: "title",
      title: "Bakery orders",
      subtitle: "Sign-off for the first release",
    },
    { layout: "section", title: "What we are asking you to approve" },
  ],
};

const files: readonly PackageFile[] = [
  {
    path: "deck.pptx",
    label: "Slide deck (.pptx)",
    included: true,
    onOpenSource: null,
  },
  {
    path: "deck.pdf",
    label: "Printable handout (.pdf)",
    included: true,
    onOpenSource: null,
  },
  {
    path: "documents/problem_brief.md",
    label: "Brief — Bakery orders (v2)",
    included: true,
    onOpenSource: fn(),
  },
  {
    path: "documents/prd.md",
    label: "Requirements — Bakery orders (v3)",
    included: true,
    onOpenSource: fn(),
  },
];

/** A reviewer whose package went out and who has not answered. */
function reviewer(
  name: string,
  persona: string,
  rest: Partial<Reviewer> = {},
): Reviewer {
  return {
    id: name,
    name,
    persona,
    goal: `Review and sign off from the ${persona} perspective.`,
    status: "sent",
    justAdded: false,
    fields: { name, persona, goal: "", outcome: "", note: "" },
    unsaved: {
      name: false,
      persona: false,
      goal: false,
      outcome: false,
      note: false,
    },
    onEdit: fn(),
    savingDetails: false,
    onSaveDetails: fn(),
    savingDecision: false,
    onSaveOutcome: fn(),
    onSaveNote: fn(),
    fault: null,
    deck,
    generatingDeck: false,
    onGenerateDeck: fn(),
    download: {
      open: false,
      files,
      downloading: false,
      onOpen: fn(),
      onOpenChange: fn(),
      onToggleFile: fn(),
      onToggleAllFiles: fn(),
      onDownload: fn(),
    },
    findings: [],
    ...rest,
  };
}

/** A reviewer who answered, with the note they left. */
function decided(
  name: string,
  persona: string,
  outcome: "approve" | "request_changes" | "comment",
  note: string,
  findings: readonly Finding[] = [],
): Reviewer {
  const sent = reviewer(name, persona);
  return {
    ...sent,
    status: outcome,
    fields: { ...sent.fields, outcome, note },
    findings,
  };
}

function finding(text: string, rest: Partial<Finding> = {}): Finding {
  return {
    id: text,
    text,
    slide: null,
    status: "pending",
    busy: false,
    fault: null,
    onIncorporate: fn(),
    onDismiss: fn(),
    ...rest,
  };
}

function round(
  packageVersion: number,
  reviewers: readonly Reviewer[],
  rest: Partial<Round> = {},
): Round {
  return {
    id: `round-${String(packageVersion)}`,
    packageVersion,
    status: "open",
    canSettle: false,
    settling: false,
    fault: null,
    onSettle: fn(),
    reviewers,
    ...rest,
  };
}

const priya = decided(
  "Priya Nair",
  "Budget approver",
  "request_changes",
  "The Saturday staffing numbers need a source.",
  [
    finding("Say where the Saturday staffing numbers come from.", { slide: 4 }),
    finding("Show the cost of the second till separately."),
  ],
);
const jordan = decided("Jordan Lee", "CTO", "approve", "Good to build.");
const sam = reviewer("Sam Ortiz", "Project owner");

const meta = {
  title: "Screens/Workspace/ApprovalRounds",
  component: ApprovalRoundsView,
  args: {
    flush: false,
    loading: false,
    fault: null,
    packageDeck: deck,
    rounds: [],
    addingReviewer: false,
    onAddingReviewerChange: fn(),
    addReviewerForm: <SharePackageView {...shareForm.args} />,
  },
  render: (args) => <Panel {...args} />,
} satisfies Meta<typeof ApprovalRoundsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { loading: true } };

/** No one has been asked yet; the package's own deck is there to look at. */
export const NoRounds: Story = {};

/** Everyone has answered: there is feedback to take in or dismiss, and the round can be settled. */
export const WaitingOnYou: Story = {
  args: { rounds: [round(3, [priya, jordan], { canSettle: true })] },
};

/** Packages are out. One reviewer has no deck yet, and another's is being generated. */
export const ReviewersAtWork: Story = {
  args: {
    rounds: [
      round(3, [
        sam,
        reviewer("Jordan Lee", "CTO", { deck: null }),
        reviewer("Priya Nair", "Budget approver", {
          deck: null,
          generatingDeck: true,
          justAdded: true,
        }),
      ]),
    ],
  },
};

/** What a reviewer asked for, in each state the person can leave it. */
export const Findings: Story = {
  args: {
    rounds: [
      round(3, [
        {
          ...priya,
          findings: [
            finding("Say where the Saturday staffing numbers come from.", {
              slide: 4,
            }),
            finding("Show the cost of the second till separately.", {
              status: "incorporated",
            }),
            finding("Use the bakery's own colours on the title slide.", {
              slide: 1,
              status: "dismissed",
            }),
            finding("Add the supplier's delivery days.", { busy: true }),
            finding("Drop the loyalty card from the first release.", {
              fault: "That sign-off action did not go through.",
            }),
          ],
        },
        sam,
      ]),
    ],
  },
};

/** A name, a decision and a note typed but not saved, and one being saved. */
export const UnsavedFields: Story = {
  args: {
    rounds: [
      round(3, [
        {
          ...sam,
          fields: {
            ...sam.fields,
            name: "Samira Ortiz",
            outcome: "approve",
            note: "Approved by phone on Friday.",
          },
          unsaved: {
            ...sam.unsaved,
            name: true,
            outcome: true,
            note: true,
          },
          savingDecision: true,
        },
      ]),
    ],
  },
};

export const Approved: Story = {
  args: {
    rounds: [
      round(
        3,
        [
          jordan,
          decided(
            "Priya Nair",
            "Budget approver",
            "approve",
            "Within this quarter's budget.",
          ),
        ],
        { status: "settled" },
      ),
    ],
  },
};

/** Settled with changes asked for; the feedback was taken into the next version. */
export const ChangesRequested: Story = {
  args: {
    rounds: [
      round(
        3,
        [
          {
            ...priya,
            findings: priya.findings.map((item) => ({
              ...item,
              status: "incorporated" as const,
            })),
          },
          decided(
            "Jordan Lee",
            "CTO",
            "comment",
            "Fine by me once the numbers are sourced.",
          ),
        ],
        { status: "settled" },
      ),
    ],
  },
};

/** The reviewers ran out of time before answering. */
export const Expired: Story = {
  args: {
    rounds: [
      round(
        3,
        [
          reviewer("Sam Ortiz", "Project owner", { status: "expired" }),
          reviewer("Jordan Lee", "CTO", { status: "expired" }),
        ],
        { status: "expired", canSettle: true },
      ),
    ],
  },
};

/** The rounds could not be read, settling did not go through, and neither did a save. */
export const Failed: Story = {
  args: {
    fault: "That sign-off action did not go through.",
    rounds: [
      round(
        3,
        [
          { ...priya, fault: "The hub could not be reached. Try again." },
          jordan,
        ],
        {
          canSettle: true,
          fault: "That sign-off action did not go through.",
        },
      ),
    ],
  },
};

export const Settling: Story = {
  args: {
    rounds: [round(3, [priya, jordan], { canSettle: true, settling: true })],
  },
};

/** Each version of the package that went out has its own round, newest first. */
export const SeveralRounds: Story = {
  args: {
    rounds: [
      round(3, [sam, reviewer("Jordan Lee", "CTO")]),
      round(2, [priya, jordan], { status: "settled" }),
      round(
        1,
        [reviewer("Sam Ortiz", "Project owner", { status: "expired" })],
        {
          status: "expired",
          canSettle: true,
        },
      ),
    ],
  },
};

/** Choosing which of a reviewer's files to download. */
export const ChoosingFiles: Story = {
  args: {
    rounds: [
      round(3, [
        {
          ...sam,
          download: {
            ...sam.download,
            open: true,
            files: files.map((file) =>
              file.path === "deck.pdf" ? { ...file, included: false } : file,
            ),
          },
        },
      ]),
    ],
  },
};

export const AddingReviewer: Story = {
  args: {
    addingReviewer: true,
    rounds: [round(3, [sam])],
  },
};

/** Inside the package's document tab, which names it: no heading, lead or round titles. */
export const InDocumentTab: Story = {
  args: {
    flush: true,
    rounds: [round(3, [priya, jordan], { canSettle: true })],
  },
};
