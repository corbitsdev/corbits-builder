import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, waitFor } from "storybook/test";
import PublishedView from "@plugins/publish/src/published/view.tsx";
import { text } from "@plugins/publish/src/published/definition.ts";
import type { PublishHolding } from "@corbits-builder/publish-contract";
import type {
  PublishKeepNotice,
  PublishState,
  Publishing,
} from "@plugins/publish/src/published/state.ts";
import type { ComponentType } from "react";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { listedHost, type ViewResources } from "./screen-question.tsx";
import { storySupplies } from "./screen-story.tsx";

// The publish plugin's own tab, hosted as the room hosts a plugin's shown screen, which hands a
// view the state the hub worked out as it is.
const Listed = listedHost(
  "@corbits-builder/publish published",
  "publish",
  PublishedView as ComponentType<
    ScreenViewProps<unknown, unknown, unknown, ViewResources>
  >,
);

const URL = "http://203.0.113.7";
const AT = "2026-11-17T10:00:00.000Z";
const LIVE = { state: "published", url: URL, at: AT } as const;
const CHANGED = { state: "changes", url: URL, at: AT } as const;
// The temporary account's app, at the address it was given there.
const BAKERY = {
  state: "published",
  url: "https://bakery-orders.example.dev",
  at: AT,
} as const;

// A link that works like a password: the view never shows it, only opens it.
const KEEP = "https://dash.example.com/claim?token=example";
const PLACE = "Example Host";
const pending = (minutesLeft: number): PublishKeepNotice => ({
  link: KEEP,
  place: PLACE,
  passed: false,
  minutesLeft,
});
const passed: PublishKeepNotice = { link: KEEP, place: PLACE, passed: true };

const HELD: PublishHolding = {
  target: "example",
  place: "Example Cloud",
  since: "2026-11-17T09:00:00.000Z",
  costs: "$6 a month",
};

// Hosting at a cost, where a take-down is offered.
const HOSTED_LINE = { holding: HELD, takeDown: true };

const shown = (
  state: PublishState,
  keep: PublishKeepNotice | null = null,
  more: Partial<Pick<Publishing, "holding" | "takeDown">> = {},
): { state: Publishing } => ({
  state: { state, keep, holding: null, takeDown: false, ...more },
});

const meta = {
  title: "Screens/Plugins/Publish/Tab",
  component: Listed,
  parameters: { layout: "fullscreen" },
  args: {
    ...shown({ state: "unpublished" }),
    act: fn(async (): Promise<string | undefined> => undefined),
    host: storySupplies,
  },
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Listed>;

export default meta;
type Story = StoryObj<typeof meta>;

// What a press ran, as the room runs a plugin's action.
const asked = (what: "publish" | "takeDown") => [
  "publish",
  "ask",
  { for: what },
];
const gone = (what: "keep" | "holding" | "release") => [
  "publish",
  "gone",
  { what },
];

/** A saved app that was never published: what publishing does, and the button to ask for it. */
export const NotPublished: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.unpublished.action }),
    );
    await expect(args.act).toHaveBeenCalledWith(...asked("publish"));
  },
};

/** A press that did not go through says why, below the state. */
export const PressRefused: Story = {
  args: { act: fn(async () => "Builder could not take that in. Try again.") },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.unpublished.action }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Builder could not take that in. Try again.",
    );
  },
};

/** A publishing run is at work, or other work is, such as a change the app needs before it goes out. */
export const InProgress: Story = { args: shown({ state: "publishing" }) };

/** Under way, but nothing is working on it and nothing is asked: the button to continue. */
export const Stalled: Story = {
  args: shown({ state: "stalled" }),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.stalled.action }),
    );
    await expect(args.act).toHaveBeenCalledWith(...asked("publish"));
  },
};

/** Publishing waits on the person's answer in the conversation. */
export const NeedsYou: Story = { args: shown({ state: "needsYou" }) };

export const Published: Story = {
  args: shown(LIVE),
};

/** A newer version was saved since: the published app is older than the saved one. */
export const Changes: Story = {
  args: shown(CHANGED),
};

/** The publisher said what stopped it. */
export const Failed: Story = {
  args: shown({
    state: "failed",
    reason:
      "The server did not accept Builder's key. Add the key to the server's authorized keys, then try again.",
  }),
};

/** The run failed without saying why. */
export const FailedWithoutReason: Story = {
  args: shown({ state: "failed", reason: undefined }),
};

/**
 * Published on a temporary account. The person keeps the app before the time runs out, or says
 * they did, which is confirmed before the link is cleared for good.
 */
export const Keep: Story = {
  args: shown(BAKERY, pending(52)),
  play: async ({ args, canvas, userEvent }) => {
    const kept = await canvas.findByRole("button", { name: text.keep.kept });
    await expect(canvas.queryByText(KEEP)).toBeNull();
    await userEvent.click(kept);
    await expect(args.act).not.toHaveBeenCalled();
    await expect(
      canvas.getByRole("group", { name: text.keep.sure.lead(PLACE) }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: text.keep.sure.yes }),
    );
    await expect(args.act).toHaveBeenCalledWith("publish", "kept", {});
  },
};

/** The person had not kept it yet when asked: nothing is cleared and the first ask comes back. */
export const KeepNotYet: Story = {
  args: shown(LIVE, pending(40)),
  play: async ({ args, canvas, userEvent }) => {
    const kept = () => canvas.getByRole("button", { name: text.keep.kept });
    await userEvent.click(kept());
    await expect(
      canvas.getByRole("button", { name: text.keep.sure.notYet }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(kept()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    await expect(kept()).toHaveFocus();
    await expect(args.act).not.toHaveBeenCalled();
  },
};

/** The last minute before the deadline. */
export const KeepLastMinute: Story = {
  args: shown(BAKERY, pending(0)),
};

/** More than an hour left, in hours and minutes. */
export const KeepHours: Story = {
  args: shown(LIVE, pending(65)),
};

/** A change saved during the hour: the deadline still applies, so the keep link stays on top. */
export const KeepOverChanges: Story = {
  args: shown(CHANGED, pending(40)),
};

/** No release was recorded, as when the app answered too slowly: the keep link still shows. */
export const KeepOverUnpublished: Story = {
  args: shown({ state: "unpublished" }, pending(40)),
};

/** An upload failed after the account was made. */
export const KeepOverFailed: Story = {
  args: shown({ state: "failed", reason: undefined }, pending(40)),
};

/** Publishing again while the first app still waits to be kept. */
export const KeepOverPublishing: Story = {
  args: shown({ state: "publishing" }, pending(40)),
};

/** A question is open while the first app still waits to be kept. */
export const KeepOverNeedsYou: Story = {
  args: shown({ state: "needsYou" }, pending(40)),
};

/**
 * The deadline passed, so the tab cannot tell whether the person kept the app. It offers both
 * answers, and either one clears the notice.
 */
export const KeepPassed: Story = {
  args: shown(BAKERY, passed),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.keep.passed.action }),
    );
    await expect(args.act).toHaveBeenCalledWith(...asked("publish"));
    await userEvent.click(canvas.getByRole("button", { name: text.keep.kept }));
    await expect(args.act).toHaveBeenCalledWith("publish", "kept", {});
    await userEvent.click(
      canvas.getByRole("button", { name: text.keep.passed.gone }),
    );
    await expect(args.act).toHaveBeenCalledWith(...gone("keep"));
  },
};

/** After the deadline, with changes: the state's own button publishes, so the notice adds none. */
export const KeepPassedOverChanges: Story = {
  args: shown(CHANGED, passed),
};

/** Published where a take-down is offered: a quiet way to ask, apart from the state's own button. */
export const PublishedTakeDown: Story = {
  args: shown(LIVE, null, {
    takeDown: true,
  }),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.takeDown.action }),
    );
    await expect(args.act).toHaveBeenCalledWith(...asked("takeDown"));
    await expect(args.act).not.toHaveBeenCalledWith(...asked("publish"));
  },
};

/** Changes to publish, with a take-down offered below, apart from Publish changes. */
export const ChangesTakeDown: Story = {
  args: shown(CHANGED, null, {
    takeDown: true,
  }),
};

/** A take-down is at work. */
export const TakingDown: Story = { args: shown({ state: "takingDown" }) };

/** A take-down did not finish: the remover's reason, and a retry that asks for the take-down. */
export const TakeDownFailed: Story = {
  args: shown({
    state: "takeDownFailed",
    reason:
      "Your server did not answer. Check in your hosting provider's control panel that it is running, then try again.",
    released: true,
  }),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: text.takeDownFailed.action }),
    );
    await expect(args.act).toHaveBeenCalledWith(...asked("takeDown"));
    await expect(args.act).not.toHaveBeenCalledWith(...asked("publish"));
  },
};

/** The take-down did not say why. */
export const TakeDownFailedWithoutReason: Story = {
  args: shown({ state: "takeDownFailed", reason: undefined, released: true }),
};

const removed = text.takeDownFailed;

/**
 * A take-down that can never finish, as when the person cancelled the app's server. The menu beside
 * the remover's reason says it is gone, and confirms before anything is cleared.
 */
export const TakeDownFailedGone: Story = {
  args: shown({
    state: "takeDownFailed",
    reason: "Your server did not answer.",
    released: true,
  }),
  play: async ({ args, userEvent }) => {
    await userEvent.click(
      screen.getByRole("button", { name: removed.options }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: removed.gone }),
    );
    await expect(args.act).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: removed.sure }),
    );
    await expect(args.act).toHaveBeenCalledWith(...gone("release"));
  },
};

/** Only the holding failed to come down, and its own line has the menu to say it is gone. */
export const TakeDownFailedHolding: Story = {
  args: shown(
    { state: "takeDownFailed", reason: undefined, released: false },
    null,
    { holding: HELD },
  ),
};

const held = text.holding;
const options = (place: string) =>
  screen.findByRole("button", { name: held.options(place) });

/**
 * Hosting set up with nothing published on it yet: where, since when and what it costs, as one
 * quiet line below the state. The menu confirms before saying it is gone clears anything.
 */
export const Holding: Story = {
  args: shown({ state: "unpublished" }, null, HOSTED_LINE),
  play: async ({ args, userEvent }) => {
    await userEvent.click(await options(HELD.place));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: held.gone(HELD.place) }),
    );
    await expect(args.act).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: held.sure(HELD.place) }),
    );
    await expect(args.act).toHaveBeenCalledWith(...gone("holding"));
  },
};

/**
 * Published on hosting that costs money: the hosting is one more fact under the address and the
 * date. The menu works from the keyboard, its first item only asks, and closing it returns focus.
 */
export const HoldingPublished: Story = {
  args: shown(LIVE, null, HOSTED_LINE),
  play: async ({ args, userEvent }) => {
    const menu = await options(HELD.place);
    menu.focus();
    await userEvent.keyboard("{Enter}");
    const goneItem = await screen.findByRole("menuitem", {
      name: held.gone(HELD.place),
    });
    // A pressed Enter puts focus on the first item; one simulated here leaves it on the menu.
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(goneItem).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(
      await screen.findByRole("menuitem", { name: held.sure(HELD.place) }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
    await expect(args.act).not.toHaveBeenCalled();
  },
};

/** Changes to publish on that hosting: the line stays with the address. */
export const HoldingChanges: Story = {
  args: shown(CHANGED, null, HOSTED_LINE),
};

/** A publish under way on the hosting. */
export const HoldingOverPublishing: Story = {
  args: shown({ state: "publishing" }, null, { holding: HELD }),
};

/** Publishing to the hosting did not finish; the hosting is still there. */
export const HoldingOverFailed: Story = {
  args: shown({ state: "failed", reason: undefined }, null, HOSTED_LINE),
};

/** A question is open about the hosting, and the hosting line is below it. */
export const HoldingOverNeedsYou: Story = {
  args: shown({ state: "needsYou" }, null, { holding: HELD }),
};

/** Another target, which does not say what it costs. */
export const HoldingWithoutCost: Story = {
  args: shown(LIVE, null, {
    holding: { target: "example", place: "Example Host", since: HELD.since },
    takeDown: true,
  }),
};

/** On a temporary account and hosted at a cost: the deadline comes first, the hosting is a fact. */
export const HoldingWithKeep: Story = {
  args: shown(LIVE, pending(40), HOSTED_LINE),
};
