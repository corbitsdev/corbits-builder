import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, waitFor } from "storybook/test";
import { wording } from "../../config.ts";
import type {
  PublishHoldingNotice,
  PublishKeepNotice,
  PublishState,
  Publishing,
} from "./publish-state.ts";
import { PublishView } from "./publish.view.tsx";
import { PublishControl } from "./room.view.tsx";
import { ScreenStory } from "./screen-story.tsx";
import { confirmScreen } from "./publish-screens.stories.tsx";

const URL = "http://203.0.113.7";
const AT = "2026-11-17T10:00:00.000Z";

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

const HELD: PublishHoldingNotice = {
  place: "Example Cloud",
  since: "2026-11-17T09:00:00.000Z",
  costs: "$6 a month",
};

const shown = (
  state: PublishState,
  keep: PublishKeepNotice | null = null,
  more: Partial<Pick<Publishing, "holding" | "takeDown">> = {},
): { publish: Publishing } => ({
  publish: { state, keep, holding: null, takeDown: false, ...more },
});

const meta = {
  title: "Screens/Workspace/Publish",
  component: PublishView,
  parameters: { layout: "fullscreen" },
  args: {
    ...shown({ state: "unpublished" }),
    onPublish: fn(),
    sending: false,
    question: null,
    onKept: fn(),
    onGone: fn(),
    keeping: false,
    keptFault: null,
    onTakeDown: fn(),
    onHeldGone: fn(),
    onReleaseGone: fn(),
    clearing: false,
    clearFault: null,
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
} satisfies Meta<typeof PublishView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A saved app that was never published: what publishing does, and the button to ask for it. */
export const NotPublished: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: wording.publish.unpublished.action,
      }),
    );
    await expect(args.onPublish).toHaveBeenCalled();
  },
};

/** The person's request is on its way to the coordinator. */
export const Sending: Story = { args: { sending: true } };

/** A publishing run is at work, or other work is, such as a change the app needs before it goes out. */
export const InProgress: Story = {
  args: shown({ state: "publishing" }),
};

/** Under way, but nothing is working on it and nothing is asked: the button to continue. */
export const Stalled: Story = {
  args: shown({ state: "stalled" }),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: wording.publish.stalled.action,
      }),
    );
    await expect(args.onPublish).toHaveBeenCalled();
  },
};

const question = (
  <ScreenStory
    screen={confirmScreen}
    state="open"
    input={{ plan: "publish-to-server" }}
    project={{}}
  />
);

/** Publishing waits on the person: the question is drawn here, not in the conversation. */
export const NeedsYou: Story = {
  args: { ...shown({ state: "needsYou" }), question },
};

export const Published: Story = {
  args: shown({ state: "published", url: URL, at: AT }),
};

/** A newer version was saved since: the published app is older than the saved one. */
export const Changes: Story = {
  args: shown({ state: "changes", url: URL, at: AT }),
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

/** An archived project shows where publishing stands but cannot publish. */
export const Archived: Story = {
  render: (args) => (
    <PublishView
      {...args}
      onPublish={undefined}
      onKept={undefined}
      onTakeDown={undefined}
      onHeldGone={undefined}
    />
  ),
};

/**
 * Published on a temporary account. The person keeps the app before the time runs out, or says
 * they did, which is confirmed before the link is cleared for good.
 */
export const Keep: Story = {
  args: shown(
    { state: "published", url: "https://bakery-orders.example.dev", at: AT },
    pending(52),
  ),
  play: async ({ args, canvas, userEvent }) => {
    await expect(await canvas.findByText("52 minutes left")).toBeVisible();
    await expect(canvas.queryByText(KEEP)).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: wording.publish.keep.kept }),
    );
    await expect(args.onKept).not.toHaveBeenCalled();
    await expect(
      canvas.getByRole("group", {
        name: wording.publish.keep.sure.lead(PLACE),
      }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: wording.publish.keep.sure.yes }),
    );
    await expect(args.onKept).toHaveBeenCalled();
  },
};

/** The person had not kept it yet when asked: nothing is cleared and the first ask comes back. */
export const KeepNotYet: Story = {
  args: shown({ state: "published", url: URL, at: AT }, pending(40)),
  play: async ({ args, canvas, userEvent }) => {
    const kept = () =>
      canvas.getByRole("button", { name: wording.publish.keep.kept });
    await userEvent.click(kept());
    await expect(
      canvas.getByRole("button", { name: wording.publish.keep.sure.notYet }),
    ).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(kept()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    await expect(kept()).toHaveFocus();
    await expect(args.onKept).not.toHaveBeenCalled();
  },
};

/** The last minute before the deadline. */
export const KeepLastMinute: Story = {
  args: shown(
    { state: "published", url: "https://bakery-orders.example.dev", at: AT },
    pending(0),
  ),
};

/** More than an hour left, in hours and minutes. */
export const KeepHours: Story = {
  args: shown({ state: "published", url: URL, at: AT }, pending(65)),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("1 hour 5 minutes left"),
    ).toBeVisible();
  },
};

/** A change saved during the hour: the deadline still applies, so the keep link stays on top. */
export const KeepOverChanges: Story = {
  args: shown({ state: "changes", url: URL, at: AT }, pending(40)),
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
  args: { ...shown({ state: "needsYou" }, pending(40)), question },
};

/** Saving that it was kept, with the answer given still on screen. */
export const KeepSaying: Story = {
  args: {
    ...shown({ state: "published", url: URL, at: AT }, pending(40)),
    keeping: true,
  },
};

/** Saying it was kept did not save. */
export const KeepNotSaved: Story = {
  args: {
    ...shown({ state: "published", url: URL, at: AT }, pending(40)),
    keptFault: wording.publish.keep.notSaved,
  },
};

/**
 * The deadline passed, so the tab cannot tell whether the person kept the app. It offers both
 * answers, and either one clears the notice.
 */
export const KeepPassed: Story = {
  args: shown(
    { state: "published", url: "https://bakery-orders.example.dev", at: AT },
    passed,
  ),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: wording.publish.keep.passed.action,
      }),
    );
    await expect(args.onPublish).toHaveBeenCalled();
    await userEvent.click(
      canvas.getByRole("button", { name: wording.publish.keep.kept }),
    );
    await expect(args.onKept).toHaveBeenCalled();
    await userEvent.click(
      canvas.getByRole("button", { name: wording.publish.keep.passed.gone }),
    );
    await expect(args.onGone).toHaveBeenCalled();
  },
};

/** After the deadline, with changes: the state's own button publishes, so the notice adds none. */
export const KeepPassedOverChanges: Story = {
  args: shown({ state: "changes", url: URL, at: AT }, passed),
};

/**
 * Published where a take-down is offered: a quiet way to ask, apart from the state's own button.
 * It sends the person's message as Publish does, and they decide on the screen it opens.
 */
export const PublishedTakeDown: Story = {
  args: shown({ state: "published", url: URL, at: AT }, null, {
    takeDown: true,
  }),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: wording.publish.takeDown.action,
      }),
    );
    await expect(args.onTakeDown).toHaveBeenCalled();
    await expect(args.onPublish).not.toHaveBeenCalled();
  },
};

/** Changes to publish, with a take-down offered below, apart from Publish changes. */
export const ChangesTakeDown: Story = {
  args: shown({ state: "changes", url: URL, at: AT }, null, {
    takeDown: true,
  }),
};

/** A take-down is at work. */
export const TakingDown: Story = {
  args: shown({ state: "takingDown" }),
};

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
      await canvas.findByRole("button", {
        name: wording.publish.takeDownFailed.action,
      }),
    );
    await expect(args.onTakeDown).toHaveBeenCalled();
    await expect(args.onPublish).not.toHaveBeenCalled();
  },
};

/** The take-down did not say why. */
export const TakeDownFailedWithoutReason: Story = {
  args: shown({ state: "takeDownFailed", reason: undefined, released: true }),
};

const removed = wording.publish.takeDownFailed;

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
    await expect(args.onReleaseGone).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: removed.sure }),
    );
    await expect(args.onReleaseGone).toHaveBeenCalled();
  },
};

/** Only the holding failed to come down, and its own line has the menu to say it is gone. */
export const TakeDownFailedHolding: Story = {
  args: shown(
    { state: "takeDownFailed", reason: undefined, released: false },
    null,
    {
      holding: HELD,
    },
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("button", { name: removed.options }),
    ).toBeNull();
  },
};

const held = wording.publish.holding;
const options = (place: string) =>
  screen.getByRole("button", { name: held.options(place) });

/**
 * Hosting set up with nothing published on it yet: where, since when and what it costs, as one
 * quiet line below the state. The menu confirms before saying it is gone clears anything.
 */
export const Holding: Story = {
  args: shown({ state: "unpublished" }, null, {
    holding: HELD,
    takeDown: true,
  }),
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      await canvas.findByText(held.since(HELD.place, HELD.costs, HELD.since)),
    ).toBeVisible();
    await userEvent.click(options(HELD.place));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: held.gone(HELD.place) }),
    );
    await expect(args.onHeldGone).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: held.sure(HELD.place) }),
    );
    await expect(args.onHeldGone).toHaveBeenCalled();
  },
};

/**
 * Published on hosting that costs money: the hosting is one more fact under the address and the
 * date. The menu works from the keyboard, its first item only asks, and closing it returns focus.
 */
export const HoldingPublished: Story = {
  args: shown({ state: "published", url: URL, at: AT }, null, {
    holding: HELD,
    takeDown: true,
  }),
  play: async ({ args, canvas, userEvent }) => {
    await expect(
      await canvas.findByText(held.hosted(HELD.place, HELD.costs)),
    ).toBeVisible();
    options(HELD.place).focus();
    await userEvent.keyboard("{Enter}");
    const gone = await screen.findByRole("menuitem", {
      name: held.gone(HELD.place),
    });
    // A pressed Enter puts focus on the first item; one simulated here leaves it on the menu.
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(gone).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(
      await screen.findByRole("menuitem", { name: held.sure(HELD.place) }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(options(HELD.place)).toHaveFocus());
    await expect(args.onHeldGone).not.toHaveBeenCalled();
  },
};

/** Changes to publish on that hosting: the line stays with the address. */
export const HoldingChanges: Story = {
  args: shown({ state: "changes", url: URL, at: AT }, null, {
    holding: HELD,
    takeDown: true,
  }),
};

/** A publish under way on the hosting. */
export const HoldingOverPublishing: Story = {
  args: shown({ state: "publishing" }, null, { holding: HELD }),
};

/** Publishing to the hosting did not finish; the hosting is still there. */
export const HoldingOverFailed: Story = {
  args: shown({ state: "failed", reason: undefined }, null, {
    holding: HELD,
    takeDown: true,
  }),
};

/** A question is open about the hosting, and the hosting line is below it. */
export const HoldingOverNeedsYou: Story = {
  args: {
    ...shown({ state: "needsYou" }, null, { holding: HELD }),
    question,
  },
};

/** Another target, which does not say what it costs. */
export const HoldingWithoutCost: Story = {
  args: shown({ state: "published", url: URL, at: AT }, null, {
    holding: { place: "Example Host", since: HELD.since, costs: undefined },
    takeDown: true,
  }),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(held.hosted("Example Host", undefined)),
    ).toBeVisible();
  },
};

/** On a temporary account and hosted at a cost: the deadline comes first, the hosting is a fact. */
export const HoldingWithKeep: Story = {
  args: shown({ state: "published", url: URL, at: AT }, pending(40), {
    holding: HELD,
    takeDown: true,
  }),
};

/** An archived project shows its hosting but offers no menu. */
export const HoldingArchived: Story = {
  args: shown({ state: "published", url: URL, at: AT }, null, {
    holding: HELD,
  }),
  render: (args) => (
    <PublishView {...args} onPublish={undefined} onHeldGone={undefined} />
  ),
};

/** Saving that it is gone: the menu's items are disabled. */
export const HoldingClearing: Story = {
  args: {
    ...shown({ state: "published", url: URL, at: AT }, null, {
      holding: HELD,
    }),
    clearing: true,
  },
};

/** Saying it is gone did not save. */
export const HoldingNotSaved: Story = {
  args: {
    ...shown({ state: "published", url: URL, at: AT }, null, {
      holding: HELD,
      takeDown: true,
    }),
    clearFault: wording.publish.goneNotSaved,
  },
};

const CONTROLS: readonly Publishing[] = (
  [
    [{ state: "unpublished" }, null],
    [{ state: "publishing" }, null],
    [{ state: "stalled" }, null],
    [{ state: "needsYou" }, null],
    [{ state: "published", url: URL, at: AT }, null],
    [{ state: "changes", url: URL, at: AT }, null],
    [{ state: "failed", reason: undefined }, null],
    [{ state: "takingDown" }, null],
    [{ state: "takeDownFailed", reason: undefined, released: true }, null],
    [{ state: "changes", url: URL, at: AT }, pending(40)],
    [{ state: "published", url: URL, at: AT }, passed],
  ] as const
).map(([state, keep]) => shown(state, keep).publish);

/** The control beside the plan in each state, as the room's top controls draw it. */
export const Control: Story = {
  render: () => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: 16,
      }}
    >
      {CONTROLS.map((publishing, index) => (
        <PublishControl key={index} publishing={publishing} onOpen={fn()} />
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", {
        name: wording.publish.controlName(wording.publish.control.keep),
      }),
    ).toBeVisible();
  },
};
