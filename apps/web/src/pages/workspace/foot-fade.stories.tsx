import type { Meta, StoryObj } from "@storybook/react-vite";
import { DocumentView } from "@corbits-builder/plugin-ui/markdown";
import { DocumentPage } from "./document-page.tsx";
import { PROBLEM_BRIEF } from "./document-page.stories.tsx";
import { FootFade } from "./foot-fade.tsx";
import { composer } from "./prompt-box.fixtures.ts";
import { RoomDockView } from "./room.view.tsx";
import { splitLeadingHeading } from "./reading-selection.ts";

const meta = {
  title: "Components/Workspace/FootFade",
  component: FootFade,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FootFade>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page runs on under the prompt box, and the fade keeps the box clear of the words under it. */
export const UnderThePromptBox: Story = {
  render: () => (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "100vh",
      }}
    >
      <DocumentPage
        project="Bakery orders"
        title="Problem brief"
        meta=""
        groups={[]}
      >
        <DocumentView source={splitLeadingHeading(PROBLEM_BRIEF).body} />
      </DocumentPage>
      <FootFade />
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 24,
          width: "min(560px, 100% - 32px)",
          margin: "0 auto",
        }}
      >
        <RoomDockView dock={composer} />
      </div>
    </div>
  ),
};
