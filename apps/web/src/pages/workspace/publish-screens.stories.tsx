import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import publish from "@plugins/publish/package.json";
import chooseDefinition from "@plugins/publish/src/choose/definition.ts";
import ChooseView from "@plugins/publish/src/choose/view.tsx";
import confirmDefinition from "@plugins/publish/src/confirm/definition.ts";
import ConfirmView from "@plugins/publish/src/confirm/view.tsx";
import takeDownDefinition from "@plugins/publish/src/take-down/definition.ts";
import TakeDownView from "@plugins/publish/src/take-down/view.tsx";
import type { ReadyPlanOffer } from "@corbits-builder/plugin";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const chooseScreen = storyScreen(
  "@corbits-builder/publish choose",
  publish.builder.actions["choose"],
  { screen: chooseDefinition, view: ChooseView, data: undefined },
);

const confirmScreen = storyScreen(
  "@corbits-builder/publish confirm",
  publish.builder.actions["confirm"],
  { screen: confirmDefinition, view: ConfirmView, data: undefined },
);

const takeDownScreen = storyScreen(
  "@corbits-builder/publish take-down",
  publish.builder.actions["take-down"],
  { screen: takeDownDefinition, view: TakeDownView, data: undefined },
);

// The ready-made publish plans the stories' project installs.
const PLANS: readonly ReadyPlanOffer[] = [
  {
    handle: "publish-to-server",
    about:
      "Your own server: one you already rent. Your hosting provider bills you.",
    firstRun:
      "It goes on your own server, at its IP address. That address isn't secure (https) yet, so don't use the app for passwords or payments.",
    groups: ["publish"],
    plugins: ["publish", "server"],
    takeDown: {
      plugin: "server",
      action: "remove",
      removes: {
        what: "Your app stops answering at its address. The server stays yours, and your hosting provider bills you for it until you cancel it there.",
        entered:
          "What people entered in the app stays on your server, and comes back if you publish again.",
      },
    },
  },
  {
    handle: "publish-to-host",
    about:
      "Example Host: a secure (https) web address of its own. Free to start, and no account needed.",
    firstRun: "It goes on Example Host, at a secure web address of its own.",
    groups: ["publish"],
    plugins: ["host", "publish"],
    takeDown: {
      plugin: "host",
      action: "remove",
      removes: {
        what: "Builder deletes the space your app runs in at Example Host, and your app stops answering at its address.",
        entered: "What people entered in the app is deleted with it, for good.",
      },
    },
  },
];
const plans = (group: string) => (group === "publish" ? PLANS : []);

const RELEASE = {
  target: "server",
  url: "http://203.0.113.7",
  version: "abc123",
  at: "2026-11-17T10:00:00.000Z",
};
// The same release made by another target, at an address of its own there.
const ELSEWHERE = {
  ...RELEASE,
  target: "host",
  url: "https://bakery-orders.example.dev",
};
// Made there in an account the person does not hold yet, so that target cannot update it.
const HOSTED = { ...ELSEWHERE, replaceable: false };

const HELD_SINCE = "2026-11-17T09:00:00.000Z";
// What Example Host holds for the app, and what it costs when it says.
const holding = (costs?: string) => ({
  target: "host",
  place: "Example Host",
  since: HELD_SINCE,
  ...(costs === undefined ? {} : { costs }),
});

// The go-ahead to publish by plan, asked with the project's values.
const confirm = (plan: string, project: Record<string, unknown> = {}) => ({
  screen: confirmScreen,
  input: { plan },
  project,
  output: { go: true, plan },
});

// The go-ahead to take down by plan, asked with the project's values, and the answer given.
const takeDown = (
  plan: string,
  project: Record<string, unknown>,
  agreed: Record<string, string> | null,
) => ({
  screen: takeDownScreen,
  input: { plan },
  project,
  output: { agreed },
});

const meta = {
  title: "Screens/Plugins/Publish",
  component: ScreenStory,
  args: {
    screen: chooseScreen,
    state: "open",
    input: {},
    project: {},
    output: { plan: "publish-to-server" },
    plans,
  },
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const CONTINUE = "Continue";

/**
 * Choosing where to publish: the installed publish plans, in their own words, with none chosen.
 * The keyboard reaches the group, an arrow key chooses, and only then can the person continue.
 */
export const Choose: Story = {
  play: async ({ canvas, userEvent }) => {
    const radios = await canvas.findAllByRole("radio");
    for (const radio of radios)
      await expect(radio).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByRole("button", { name: CONTINUE })).toBeDisabled();
    radios[0]!.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(radios[1]).toHaveAttribute("aria-checked", "true");
    await expect(radios[1]).toHaveFocus();
    await expect(canvas.getByRole("button", { name: CONTINUE })).toBeEnabled();
  },
};

/** With one target there is no choice to make, so it is already chosen. */
export const OnePlace: Story = {
  args: { plans: (group) => plans(group).slice(0, 1) },
};

/** The person picked a target and can continue. */
export const Picked: Story = {
  args: { state: "chosen", draft: { plan: "publish-to-host" } },
};
export const Chosen: Story = { args: { state: "answered" } };

/** Before the first publish: where it goes, in the plan's own words, and who can open it. */
export const Confirm: Story = { args: confirm("publish-to-server") };

/** Before publishing changes to the same target: the saved app replaces the published one. */
export const ConfirmChanges: Story = {
  args: confirm("publish-to-server", { "publish.release": RELEASE }),
};

/**
 * Published somewhere else before: this publish makes a new address, and the one people use now
 * keeps the earlier version.
 */
export const ConfirmElsewhere: Story = {
  args: confirm("publish-to-server", { "publish.release": ELSEWHERE }),
};

/**
 * Published again to a target whose account the person does not have yet. The target cannot
 * update the app, so this publish makes a new address while the first one's keep link is recorded.
 */
export const ConfirmNotYetKept: Story = {
  args: confirm("publish-to-host", {
    "publish.release": HOSTED,
    "publish.keep": {
      link: "https://dash.example.dev/keep?token=story-only",
      until: "2026-11-17T11:00:00.000Z",
      place: "Example Host",
    },
  }),
};

/** Once the person said they kept it, publishing there updates the app they keep. */
export const ConfirmKept: Story = {
  args: confirm("publish-to-host", { "publish.release": HOSTED }),
};

export const Confirmed: Story = {
  args: { ...confirm("publish-to-server"), state: "answered" },
};

/**
 * Before taking the app off the person's own server: what is removed, and that what people
 * entered is kept, in the removal action's own words, with the address people open now.
 */
export const TakeDown: Story = {
  args: takeDown(
    "publish-to-server",
    { "publish.release": RELEASE },
    { target: "server", release: RELEASE.at },
  ),
};

/**
 * The target holds something that costs money. Where it is and what it costs show beside the
 * address, and the removal's wording says that what people entered is deleted.
 */
export const TakeDownHeld: Story = {
  args: takeDown(
    "publish-to-host",
    {
      "publish.release": ELSEWHERE,
      "publish.holding": holding("$6 a month"),
    },
    { target: "host", release: RELEASE.at, holding: HELD_SINCE },
  ),
};

/** A holding with nothing published on it yet: the go-ahead is for the holding. */
export const TakeDownHeldOnly: Story = {
  args: takeDown(
    "publish-to-host",
    { "publish.holding": holding() },
    { target: "host", holding: HELD_SINCE },
  ),
};

/** The plan's target holds nothing, as when the app went out elsewhere: nothing to take down. */
export const TakeDownNothingThere: Story = {
  args: takeDown("publish-to-host", { "publish.release": RELEASE }, null),
};

export const TakenDown: Story = {
  args: {
    ...takeDown(
      "publish-to-server",
      { "publish.release": RELEASE },
      { target: "server", release: RELEASE.at },
    ),
    state: "answered",
  },
};

export const KeptUp: Story = {
  args: {
    ...takeDown("publish-to-server", { "publish.release": RELEASE }, null),
    state: "answered",
  },
};
