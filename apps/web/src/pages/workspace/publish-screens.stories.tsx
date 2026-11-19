import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { wording } from "../../config.ts";
import publish from "@plugins/publish/package.json";
import chooseDefinition from "@plugins/publish/src/choose/definition.ts";
import ChooseView from "@plugins/publish/src/choose/view.tsx";
import confirmDefinition, {
  text as confirmText,
} from "@plugins/publish/src/confirm/definition.ts";
import ConfirmView from "@plugins/publish/src/confirm/view.tsx";
import takeDownDefinition, {
  text as takeDownText,
} from "@plugins/publish/src/take-down/definition.ts";
import TakeDownView from "@plugins/publish/src/take-down/view.tsx";
import { ScreenStory, storyScreen, storySupplies } from "./screen-story.tsx";

const chooseScreen = storyScreen(
  "@corbits-builder/publish choose",
  publish.builder.actions["choose"],
  { screen: chooseDefinition, view: ChooseView, data: undefined },
);

export const confirmScreen = storyScreen(
  "@corbits-builder/publish confirm",
  publish.builder.actions["confirm"],
  { screen: confirmDefinition, view: ConfirmView, data: undefined },
);

export const takeDownScreen = storyScreen(
  "@corbits-builder/publish take-down",
  publish.builder.actions["take-down"],
  { screen: takeDownDefinition, view: TakeDownView, data: undefined },
);

const RELEASE = {
  target: "server",
  url: "http://203.0.113.7",
  version: "abc123",
  at: "2026-11-17T10:00:00.000Z",
};

const meta = {
  title: "Screens/Plugins/Publish",
  component: ScreenStory,
  args: {
    screen: chooseScreen,
    state: "open",
    input: {},
    project: {},
    output: { plan: "publish-to-server" },
  },
} satisfies Meta<typeof ScreenStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const CONTINUE = "Continue";

/** The answered take-down looks like every answered screen: what it asked and what was chosen. */
async function answeredWith(canvas: ReturnType<typeof within>, answer: string) {
  const card = within(
    await canvas.findByRole("region", {
      name: wording.questions.screenAnswered,
    }),
  );
  await expect(card.getByText(takeDownText.title)).toBeVisible();
  await expect(card.getByText(answer)).toBeVisible();
}

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
  args: {
    supplies: {
      ...storySupplies,
      readyPlans: (group) => storySupplies.readyPlans(group).slice(0, 1),
    },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("radio")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByRole("button", { name: CONTINUE })).toBeEnabled();
  },
};

/** The person picked a target and can continue. */
export const Picked: Story = {
  args: { state: "chosen", draft: { plan: "publish-to-host" } },
};
export const Chosen: Story = { args: { state: "answered" } };

/** A confirm line: `before`, then the address as a link, then `after`. */
const aroundAddress =
  ({ before, after }: { before: string; after: string }, url: string) =>
  (_content: string, element: Element | null) =>
    element?.tagName === "LI" &&
    element.textContent === `${before}${url}${after}`;

/** Before the first publish: where it goes, in the plan's own words, and who can open it. */
export const Confirm: Story = {
  args: {
    screen: confirmScreen,
    input: { plan: "publish-to-server" },
    output: { go: true, plan: "publish-to-server" },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        storySupplies.readyPlans("publish")[0]!.firstPublish!,
      ),
    ).toBeVisible();
    await expect(canvas.getByText(confirmText.anyone)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: confirmText.go(false) }),
    ).toBeEnabled();
  },
};

/** Before publishing changes to the same target: the saved app replaces the published one. */
export const ConfirmChanges: Story = {
  args: {
    screen: confirmScreen,
    input: { plan: "publish-to-server" },
    project: { "publish.release": RELEASE },
    output: { go: true, plan: "publish-to-server" },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(aroundAddress(confirmText.replaces, RELEASE.url)),
    ).toBeVisible();
    // What the person agreed to the first time is not asked again.
    await expect(canvas.queryByText(confirmText.anyone)).toBeNull();
    await expect(
      canvas.getByRole("button", { name: confirmText.go(true) }),
    ).toBeEnabled();
  },
};

/**
 * Published somewhere else before: this publish makes a new address, and the one people use now
 * keeps the earlier version.
 */
export const ConfirmElsewhere: Story = {
  args: {
    screen: confirmScreen,
    input: { plan: "publish-to-server" },
    project: {
      "publish.release": {
        ...RELEASE,
        target: "host",
        url: "https://bakery-orders.example.dev",
      },
    },
    output: { go: true, plan: "publish-to-server" },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        aroundAddress(
          confirmText.elsewhere,
          "https://bakery-orders.example.dev",
        ),
      ),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: confirmText.go(false) }),
    ).toBeVisible();
  },
};

const HOSTED = {
  ...RELEASE,
  target: "host",
  url: "https://bakery-orders.example.dev",
  replaceable: false,
};

/**
 * Published again to a target whose account the person does not have yet. The target cannot
 * update the app, so this publish makes a new address while the first one's keep link is recorded.
 */
export const ConfirmNotYetKept: Story = {
  args: {
    screen: confirmScreen,
    input: { plan: "publish-to-host" },
    project: {
      "publish.release": HOSTED,
      "publish.keep": {
        link: "https://dash.example.dev/keep?token=story-only",
        until: "2026-11-17T11:00:00.000Z",
        place: "Example Host",
      },
    },
    output: { go: true, plan: "publish-to-host" },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(aroundAddress(confirmText.elsewhere, HOSTED.url)),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: confirmText.go(false) }),
    ).toBeVisible();
  },
};

/** Once the person said they kept it, publishing there updates the app they keep. */
export const ConfirmKept: Story = {
  args: {
    screen: confirmScreen,
    input: { plan: "publish-to-host" },
    project: { "publish.release": HOSTED },
    output: { go: true, plan: "publish-to-host" },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(aroundAddress(confirmText.replaces, HOSTED.url)),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: confirmText.go(true) }),
    ).toBeVisible();
  },
};

export const Confirmed: Story = {
  args: {
    screen: confirmScreen,
    state: "answered",
    input: { plan: "publish-to-server" },
    output: { go: true, plan: "publish-to-server" },
  },
};

/**
 * Before taking the app off the person's own server: what is removed, and that what people
 * entered is kept, in the removal action's own words, with the address people open now.
 */
export const TakeDown: Story = {
  args: {
    screen: takeDownScreen,
    input: { plan: "publish-to-server" },
    project: { "publish.release": RELEASE },
    output: { agreed: { target: "server", release: RELEASE.at } },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(RELEASE.url)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: takeDownText.go }),
    ).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: takeDownText.keep }),
    ).toBeEnabled();
  },
};

/**
 * The target holds something that costs money. Where it is and what it costs show beside the
 * address, and the removal's wording says that what people entered is deleted.
 */
export const TakeDownHeld: Story = {
  args: {
    screen: takeDownScreen,
    input: { plan: "publish-to-host" },
    project: {
      "publish.release": {
        ...RELEASE,
        target: "host",
        url: "https://bakery-orders.example.dev",
      },
      "publish.holding": {
        target: "host",
        place: "Example Host",
        since: "2026-11-17T09:00:00.000Z",
        costs: "$6 a month",
      },
    },
    output: {
      agreed: {
        target: "host",
        release: RELEASE.at,
        holding: "2026-11-17T09:00:00.000Z",
      },
    },
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(takeDownText.costs("Example Host", "$6 a month")),
    ).toBeVisible();
  },
};

/** A holding with nothing published on it yet: the go-ahead is for the holding. */
export const TakeDownHeldOnly: Story = {
  args: {
    screen: takeDownScreen,
    input: { plan: "publish-to-host" },
    project: {
      "publish.holding": {
        target: "host",
        place: "Example Host",
        since: "2026-11-17T09:00:00.000Z",
      },
    },
    output: {
      agreed: { target: "host", holding: "2026-11-17T09:00:00.000Z" },
    },
  },
};

/** The plan's target holds nothing, as when the app went out elsewhere: nothing to take down. */
export const TakeDownNothingThere: Story = {
  args: {
    screen: takeDownScreen,
    input: { plan: "publish-to-host" },
    project: { "publish.release": RELEASE },
    output: { agreed: null },
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(takeDownText.nothing)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: takeDownText.go }),
    ).toBeDisabled();
  },
};

export const TakenDown: Story = {
  args: {
    screen: takeDownScreen,
    state: "answered",
    input: { plan: "publish-to-server" },
    project: { "publish.release": RELEASE },
    output: { agreed: { target: "server", release: RELEASE.at } },
  },
  play: async ({ canvas }) => answeredWith(canvas, takeDownText.agreed),
};

export const KeptUp: Story = {
  args: {
    screen: takeDownScreen,
    state: "answered",
    input: { plan: "publish-to-server" },
    project: { "publish.release": RELEASE },
    output: { agreed: null },
  },
  play: async ({ canvas }) => answeredWith(canvas, takeDownText.kept),
};
