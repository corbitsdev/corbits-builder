import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocumentView } from "@corbits-builder/plugin-ui/markdown";
import { Download, Share2 } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  DocumentPage,
  type MarginPassage,
  type PassagePlace,
} from "./document-page.tsx";
import type { PaneBarGroup } from "./pane-bar.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";

/** The Problem brief as the hi-fi page shows it. */
export const PROBLEM_BRIEF = `# Problem brief

## In short

- **Cake orders get lost** between the phone and the paper
- The first version **takes orders online** and nothing else

Small bakeries take cake orders by phone and on paper, and lose some of them on busy days.

## Who has it

- Owners who bake and serve at once
- Counter staff who answer the phone mid-shift
- Regulars who order the same cake every month

## What it must do

- Take a cake order online: size, flavour, message and pickup date
- Flag allergies and dietary needs on every order
- Tell the customer when their cake is ready

## A good Saturday

Every order is in one list, and nobody calls back to ask.

## Not in the first version

Card payments beyond a deposit, and delivery routes.
`;

/** The brief cut off mid-word, as it reads while it is still being written. */
const PROBLEM_BRIEF_SO_FAR = PROBLEM_BRIEF.slice(
  0,
  PROBLEM_BRIEF.indexOf("size, fla") + "size, fla".length,
);

/** A brief long enough to run over several pages. */
const LONG_BRIEF = `${PROBLEM_BRIEF}
## How orders come in today

${Array.from(
  { length: 4 },
  () =>
    "Most orders arrive by phone between eight and eleven, while the first bake is still in the oven. Whoever is nearest picks up, writes the order on the pad by the till, and pins the page to the board. On a busy morning the board holds forty pages, and a page that falls behind the counter is an order nobody makes.",
).join("\n\n")}

## What a customer needs to know

- The price before they confirm
- The pickup time, and where to collect
- Who to call if something changes

## What the staff need to see

${Array.from(
  { length: 3 },
  () =>
    "One list of the day's orders, in pickup order, with the cake, the message and any allergy on one line. A finished cake is ticked off, and the customer hears that it is ready without anyone picking up the phone.",
).join("\n\n")}

## Questions still open

- Whether a deposit is taken at order time or at pickup
- How far ahead a cake can be ordered
- What happens to an order nobody collects
`;

const COMMENTED: readonly { id: string; quote: string; note: string }[] = [
  {
    id: "texts",
    quote: "Counter staff who answer the phone mid-shift",
    note: "Some regulars text their order to the counter. Should texts count too?",
  },
  {
    id: "allergy",
    quote: "Flag allergies and dietary needs",
    note: "Should the cake label show the allergy as well?",
  },
];

/** One passage in each state a comment can leave it in. */
const STATES: readonly (MarginPassage & { note: string })[] = COMMENTED.map(
  (item) =>
    item.id === "allergy" ? { ...item, state: "selected" as const } : item,
);

/**
 * A stand-in for what the margin holds, level with its passage. The comment cards themselves are
 * drawn elsewhere; this only shows where the page places them.
 */
function MarginStandIn({ place }: { place: PassagePlace }) {
  const note =
    STATES.find((item) => item.id === place.id)?.note ??
    `Not on this page: “${place.quote}”`;
  return (
    <div
      style={{
        padding: "12px 12px 14px",
        border: "1px solid var(--wb-border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--wb-background)",
        boxShadow: "var(--wb-shadow)",
        fontSize: "0.8125rem",
        lineHeight: 1.5,
      }}
    >
      {note}
    </div>
  );
}

/** Download and Share above the contents, as a written document gives them. */
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

function body(source: string) {
  return <DocumentView source={splitLeadingHeading(source).body} />;
}

const meta = {
  title: "Screens/Workspace/DocumentPage",
  component: DocumentPage,
  // The written document's stories read the same document.
  excludeStories: ["PROBLEM_BRIEF"],
  // The ground the room lays a written page on, from the person's preference.
  parameters: { layout: "fullscreen", ground: "grey" },
  args: {
    title: "Problem brief",
    files,
    passages: COMMENTED,
    margin: (place) => <MarginStandIn place={place} />,
    children: body(PROBLEM_BRIEF),
  },
  decorators: [
    (Story, { parameters }) => (
      <div
        data-ground={parameters.ground}
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DocumentPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A filed document with two commented passages, their notes level with them in the margin. */
export const Filed: Story = {};

/** The same document on the plain white ground, with no sheet and no fade. */
export const WhiteGround: Story = { parameters: { ground: "white" } };

/** A passage in each state its comment can be in: saved, and selected while it is written. */
export const PassageStates: Story = { args: { passages: STATES } };

/** A passage a later version rewrote heads the margin, above the one still on the page. */
export const PassageNotOnPage: Story = {
  args: {
    passages: [
      ...COMMENTED.slice(0, 1),
      {
        id: "rewritten",
        quote:
          "Small bakeries take cake orders by phone and lose some of them.",
      },
    ],
  },
};

export const PassageStatesDark: Story = {
  args: { passages: STATES },
  globals: { mode: "dark" },
};

/** Still being written: an orange caret ends the last line so far. */
export const Writing: Story = {
  args: {
    writing: "live",
    passages: [],
    children: body(PROBLEM_BRIEF_SO_FAR),
  },
};

/** The writing stopped before the end: a note where it stopped, with the way to start it again. */
export const WritingStopped: Story = {
  args: {
    writing: "stopped",
    onResume: fn(),
    passages: [],
    children: body(PROBLEM_BRIEF_SO_FAR),
  },
};

/** A document that runs over several pages, scrolled part way: the contents follow the section read. */
export const LongScrolled: Story = {
  args: { children: body(LONG_BRIEF) },
  play: async ({ canvasElement }) => {
    const reader = canvasElement.querySelector<HTMLElement>(
      '[data-slot="document-page"]',
    );
    reader?.scrollTo({ top: 700 });
  },
};

/** The toggle beside Download and Share folds the contents away, and its chevron turns with it. */
export const ContentsFolded: Story = {
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole("button", {
      name: wording.documentViewer.contentsToggle,
    });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  },
};

/** A document with no sections: no contents and no toggle beside Download and Share. */
export const NoSections: Story = {
  args: {
    title: "Interview notes",
    passages: [],
    children: body(
      "Three bakeries, interviewed on a Saturday morning. All three take orders by phone, and two write them on paper.",
    ),
  },
};

export const Dark: Story = { globals: { mode: "dark" } };

/** Where the pane is too narrow for the contents, Download and Share head the page instead. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 760, height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
};
