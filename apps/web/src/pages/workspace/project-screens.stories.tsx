import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import project from "@plugins/project/package.json";
import changeDirectionDefinition, {
  text,
} from "@plugins/project/src/change-direction/definition.ts";
import ChangeDirectionView from "@plugins/project/src/change-direction/view.tsx";
import type { StepStatus } from "@corbits-builder/plugin";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const changeDirectionScreen = storyScreen(
  "@corbits-builder/project change-direction",
  project.builder.actions["change-direction"],
  {
    screen: changeDirectionDefinition,
    view: ChangeDirectionView,
    data: undefined,
  },
);

const step = (
  id: string,
  title: string,
  state: StepStatus["state"],
): StepStatus => ({
  id,
  title,
  plugin: "web-app",
  action: id,
  plan: undefined,
  state,
  summary: undefined,
});

// A plan under way: the brief is done, the look waits for the person, and the rest has not started.
const PLAN: readonly StepStatus[] = [
  step("brief", "Write the brief", "done"),
  step("design", "Design the look", "needs_you"),
  step("build-plan", "Write the build plan", "not_started"),
  step("build", "Build the app", "not_started"),
  step("checks", "Check the app works", "cancelled"),
  step(
    "accounts",
    "Set up sign-in so that customers can keep their past orders, saved addresses and favourite cakes between visits",
    "waiting",
  ),
];

const INSTEAD = "a simple page that emails each bakery order to you.";

// The change of direction for these steps, and the answer given.
const changeDirection = (
  stepIds: string[],
  instead: string,
  agreed: string[] | null,
) => ({
  screen: changeDirectionScreen,
  input: { stepIds, instead },
  project: {},
  plan: PLAN,
  output: { agreed },
});

const meta = {
  title: "Screens/Plugins/Project",
  component: ScreenStory,
  args: {
    ...changeDirection(["design", "build-plan", "build"], INSTEAD, [
      "design",
      "build-plan",
      "build",
    ]),
    state: "open",
  },
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three steps the plan still holds are cancelled for the new goal. */
export const ChangeDirection: Story = {};

/** One step stops, with a long title and a long new goal. */
export const ChangeDirectionOneStep: Story = {
  args: changeDirection(
    ["accounts"],
    "guest checkout with just a name, phone number and pickup time, so the shop can start taking Saturday orders this week.",
    ["accounts"],
  ),
};

/**
 * Every step named is done or already cancelled, so there is nothing to stop and only keeping the
 * plan is offered.
 */
export const ChangeDirectionNothingLeft: Story = {
  args: changeDirection(["brief", "checks"], INSTEAD, null),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("button", { name: text.go }),
    ).toBeDisabled();
    await expect(canvas.getByRole("button", { name: text.keep })).toBeEnabled();
  },
};

export const DirectionChanged: Story = {
  args: { state: "answered" },
};

export const PlanKept: Story = {
  args: {
    ...changeDirection(["design", "build-plan", "build"], INSTEAD, null),
    state: "answered",
  },
};
