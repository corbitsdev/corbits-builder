import { defineScreen, type ScreenStatus } from "@corbits-builder/plugin";
import { type } from "arktype";
import {
  changesAt,
  publishState,
  type Publishing,
  type PublishState,
} from "./state.ts";

const minutesText = (count: number) =>
  count === 1 ? "1 minute" : `${String(count)} minutes`;

// Words said in more than one place, each kept once.
const PUBLISH = "Publish";
const CARRY_ON = "Carry on publishing";
const PUBLISH_CHANGES = "Publish changes";
const TAKING_DOWN = "Taking it down…";
const UNDER_WAY =
  "This can take a few minutes. If Builder needs you, it asks in the conversation.";
const TRY_AGAIN = "Try again";
const KEEP_YOUR_APP = "Keep your app";

// What the person reads in the Publish tab and at the top right of the room.
export const text = {
  tab: PUBLISH,
  // At the top right of the room, in each state of publishing.
  status: {
    unpublished: PUBLISH,
    publishing: "Publishing…",
    stalled: CARRY_ON,
    needsYou: "Publish · needs you",
    published: "Published",
    changes: PUBLISH_CHANGES,
    failed: "Publish failed",
    takingDown: TAKING_DOWN,
    takeDownFailed: "Take-down failed",
    // While the link to keep an app on a temporary account works, whatever the state.
    keep: KEEP_YOUR_APP,
    // Replaces Published once the deadline to keep the app passed: it may have been removed.
    keepPassed: "Time to keep it is up",
  } satisfies Record<PublishState["state"] | "keep" | "keepPassed", string>,
  unpublished: {
    title: "Publish your app",
    lead: "Put your app online so people can open it. You choose where, and nothing goes out until you say so.",
    action: PUBLISH,
  },
  publishing: { title: "Publishing your app…", lead: UNDER_WAY },
  // A publish under way that nothing is working on and nothing asks about.
  stalled: {
    title: "Publishing is paused",
    lead: "If Builder asked you something in the conversation, answer it there, or carry on from where it left off.",
    action: CARRY_ON,
  },
  needsYou: {
    title: "Publishing needs your answer",
    lead: "Builder asked you something in the conversation. Publishing carries on once you answer.",
  },
  published: { title: "Your app is published" },
  changes: {
    title: "You have changes to publish",
    lead: "People still see the version from before your latest changes.",
    action: PUBLISH_CHANGES,
  },
  failed: {
    title: "Publishing didn't finish",
    lead: "Nothing new went out. You can try again, or ask Builder what happened.",
    action: TRY_AGAIN,
  },
  takingDown: { title: TAKING_DOWN, lead: UNDER_WAY },
  takeDownFailed: {
    title: "Taking it down didn't finish",
    lead: "Your app may still be online. You can try again, or ask Builder what happened.",
    action: TRY_AGAIN,
    // For an app the person removed themselves, as by cancelling their server, which no take-down
    // can reach.
    options: "More options for taking it down",
    gone: "I already removed it myself…",
    // Asked again in the menu, because saying it by mistake forgets an app still online.
    sure: "Yes, it's gone",
  },
  // An app on a temporary account, which the person keeps by signing in at the place.
  keep: {
    heading: KEEP_YOUR_APP,
    lead: (place: string) =>
      `It's on a temporary ${place} account for now. Sign in or make a free account at ${place} to keep it, or ${place} removes it when the time runs out.`,
    left: (minutes: number) => {
      if (minutes < 1) return "Less than a minute left";
      if (minutes < 60) return `${minutesText(minutes)} left`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      const hoursText = hours === 1 ? "1 hour" : `${String(hours)} hours`;
      return rest === 0
        ? `${hoursText} left`
        : `${hoursText} ${minutesText(rest)} left`;
    },
    action: "Keep my app",
    share: "Share the address once you've kept it.",
    already: "Kept it already?",
    kept: "I kept it",
    // Asked before the link is cleared, since it cannot be shown again.
    sure: {
      lead: (place: string) =>
        `Say yes only once you've kept it at ${place}: the Keep my app button won't come back.`,
      yes: "Yes, I kept it",
      notYet: "Not yet",
    },
    saving: "Saving…",
    // The deadline to keep it passed, and nobody knows whether it was kept.
    passed: {
      heading: "The time to keep your app has passed",
      lead: (place: string) =>
        `If you kept it at ${place}, it's yours and still at its address. If not, ${place} has removed it.`,
      // Asks which it was; either answer clears the notice.
      which: "Did you keep it?",
      // Says the app was not kept, so Builder no longer counts it as published.
      gone: "I didn't keep it",
      again:
        "Publishing again gives it a new address, unless you connect your own account first.",
      action: "Publish again",
    },
  },
  // Asks the coordinator to take the app down; the question it opens asks the person first.
  takeDown: {
    note: "No longer need it online?",
    action: "Take it down",
  },
  // Where the app is hosted and what that costs, as one more fact beside its address: "Hosted on
  // Example Host · $6 a month". A place that does not state its price still bills for it.
  holding: {
    hosted: (place: string, costs: string | undefined) =>
      `Hosted on ${place} · ${costs ?? "billed there"}`,
    // Before anything is published there, when the start date is the only date in the tab.
    since: (place: string, costs: string | undefined, at: string) =>
      `Hosting on ${place} since ${new Date(at).toLocaleDateString(undefined, { dateStyle: "medium" })} · ${costs ?? "billed there"}`,
    options: (place: string) => `Options for hosting on ${place}`,
    // For hosting the person removed themselves, which Builder cannot see.
    gone: (place: string) => `I already removed it from ${place}…`,
    // Asked again in the menu, because saying it by mistake hides a real cost.
    sure: (place: string) => `Yes, it's gone from ${place}`,
  },
  // The address people open the app at, and when it went out, in plain words.
  // The address as a screen reader hears its link.
  addressLabel: (url: string) => `Address: ${url}`,
  open: "Open",
  publishedAt: (at: string) =>
    `Published ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
};

// The plan's mark for a state that needs a look, and done once published.
const MARK: Partial<Record<PublishState["state"], ScreenStatus["mark"]>> = {
  needsYou: "needs_you",
  stalled: "needs_you",
  failed: "failed",
  takeDownFailed: "failed",
  published: "done",
};

// A keep link with time left needs the person whatever the state, and after its deadline a
// published app may have been removed.
const statusOf = ({ state, keep }: Publishing): ScreenStatus => {
  if (keep !== null && !keep.passed)
    return { label: text.status.keep, mark: "needs_you" };
  if (keep !== null && state.state === "published")
    return { label: text.status.keepPassed };
  const mark = MARK[state.state];
  return mark === undefined
    ? { label: text.status[state.state] }
    : { label: text.status[state.state], mark };
};

export default defineScreen({
  places: { "main-pane": {}, "top-right": { status: statusOf } },
  state: publishState,
  changesAt,
  input: type({ "+": "reject" }),
  output: type({ "+": "reject" }),
  describe: {
    says: { label: () => text.tab },
    summary:
      "Shows the person where the app is published, with the way to publish it, publish its changes or take it down.",
    when: "The project has a saved app and a ready-made plan in the publish group is installed.",
    unless: "There is no saved app, or nowhere to publish it.",
    fields: {},
  },
});
