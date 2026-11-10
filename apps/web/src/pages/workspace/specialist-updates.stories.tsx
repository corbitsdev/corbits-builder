import type { Meta, StoryObj } from "@storybook/react-vite";
import { Conversation, ConversationContent } from "@corbits/react-ui";
import {
  FoldedUpdatesView,
  SpecialistUpdatesView,
  type UpdatesRow,
} from "./specialist-updates.view.tsx";

const constraints: UpdatesRow = {
  key: "updates:writer:1",
  title: "Constraints",
  summary: "Filed the constraints: one counter tablet, no customer accounts.",
  reports: [
    {
      at: 1,
      text: "Filed the **constraints**: one counter tablet, no customer accounts.\n\n- Orders are taken by phone only.\n- The list must work offline for a morning.",
    },
  ],
};

const build: UpdatesRow = {
  key: "updates:coder:2",
  title: "Build · 3 updates",
  summary: "The order list saves and reloads; 4 of 6 checks pass.",
  reports: [
    { at: 2, text: "Set up the app from the starter and the approved design." },
    { at: 3, text: "Wrote the order form and the Saturday list." },
    {
      at: 4,
      text: "The order list saves and reloads; 4 of 6 checks pass.\n\nStill open: marking an order collected, and the empty state.",
    },
  ],
};

const review: UpdatesRow = {
  key: "updates:reviewer:5",
  title: "Reviewer",
  summary: "The requirements cover every constraint.",
  reports: [{ at: 5, text: "The requirements cover every constraint." }],
};

const meta = {
  title: "Screens/Workspace/SpecialistUpdates",
  // A thread item registers with the conversation around it.
  decorators: [
    (Story) => (
      <Conversation>
        <ConversationContent>
          <Story />
        </ConversationContent>
      </Conversation>
    ),
  ],
} satisfies Meta;

export default meta;

/** One report, named by what it was about. */
export const OneReport: StoryObj = {
  render: () => <SpecialistUpdatesView row={constraints} />,
};

/** Consecutive reports from one specialist share a row over the latest one's first line. */
export const SeveralReports: StoryObj = {
  render: () => <SpecialistUpdatesView row={build} />,
};

/** A long run of rows under one line, each still there to open. */
export const Folded: StoryObj = {
  render: () => <FoldedUpdatesView rows={[constraints, build, review]} />,
};
