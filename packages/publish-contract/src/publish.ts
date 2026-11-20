import { type } from "arktype";
import {
  fail,
  parsed,
  pass,
  type ProjectView,
  type ReadyPlanStepBuilder,
} from "@corbits-builder/plugin";

// The project value every publish target records its latest release under, so anything that shows
// where the app is published reads one name without naming a plugin.
export const PUBLISH_RELEASE = "publish.release";

// A release as a target records it. url is the address people open, version is the saved app's
// version that was published, as a check reads it, and at is when it went out, as an ISO time.
//
// replaceable is false when the next publish to the same target cannot update this release, as
// when it went to an account the person does not hold yet. That publish makes a new app at a new
// address, and this one keeps the earlier version.
//
// The value is null once the app is taken down or gone. The target's tools clear it, and so does
// the person's word that they removed it themselves.
export const PublishRelease = type({
  "+": "reject",
  target: "string > 0",
  url: type("string.url").and(/^https?:\/\//),
  version: "string > 0",
  at: "string.date.iso",
  "replaceable?": "false",
});
export type PublishRelease = typeof PublishRelease.infer;

// The project value with the link the person opens to keep an app that was published without an
// account at its host, and when the link stops working. It is private because the link works like a
// password. A target's tool sets it, and the person's word that they kept the app, or that it is
// gone, clears it. While it is set, the app is not yet theirs.
export const PUBLISH_KEEP = "publish.keep";

// The keep link as a target records it. until is when, as an ISO time, the link stops working and
// the app is removed unless kept. place is the plain name of the place the app went to, where the
// person makes an account to keep it.
export const PublishKeep = type({
  "+": "reject",
  link: type("string.url").and(/^https:\/\//),
  until: "string.date.iso",
  place: "string > 0",
});
export type PublishKeep = typeof PublishKeep.infer;

/**
 * The run of a target's check that the app it published is the saved one, for defineCheck. It
 * compares the release the target recorded with the saved app's version. It never contacts the
 * place the app went to, so it says what was published, not that the place still serves it.
 * Because the record reads the saved app's version, a newer saved version makes the fact lapse by
 * itself until that version is published too. words name the place as the person reads it.
 */
export const publishedCheck =
  (
    target: string,
    words: {
      // Such as "The app is not published on Example Host".
      notPublished: string;
      // Such as "Example Host holds an earlier version of the app".
      earlier: string;
    },
  ) =>
  async (view: ProjectView) => {
    const saved = view.app.version;
    const recorded = parsed(PublishRelease(await view.values(PUBLISH_RELEASE)));
    if (saved === undefined) return fail("The project has no saved app");
    if (recorded?.target !== target) return fail(words.notPublished);
    if (recorded.version !== saved)
      return fail(words.earlier, [
        `published ${recorded.version} at ${recorded.at}`,
        `saved ${saved}`,
      ]);
    return pass(`The saved app is published at ${recorded.url}`, [
      `published ${recorded.version} at ${recorded.at}`,
    ]);
  };

// The project value a target records while something it made for the project costs money, such as
// a server it rented, whether or not an app is published there yet. Only the target's tools set it,
// once they make that thing, and clear it, once the provider confirms it is gone. The person's word
// that they removed it themselves clears it too. Anything that shows what the project holds reads
// one name without naming a plugin.
export const PUBLISH_HOLDING = "publish.holding";

// What a target holds, as it records it. place is the plain name of where it is, such as "Example
// Host". since is when it was made, as an ISO time. costs, when the target knows it, is the price
// as the person reads it, such as "$6 a month".
export const PublishHolding = type({
  "+": "reject",
  target: "string > 0",
  place: "string > 0",
  since: "string.date.iso",
  "costs?": "string > 0",
});
export type PublishHolding = typeof PublishHolding.infer;

// The project value with the person's go-ahead to take down what a target published or holds. Only
// the person's answers write it: their go-ahead, or null when they keep it or agree to publish
// again.
export const PUBLISH_TAKE_DOWN = "publish.take-down";

// A go-ahead to take down, as the person's answer records it. release and holding are the at of the release
// and the since of the holding that the person was shown, so the go-ahead covers only those. Either
// is absent when the target had none recorded.
export const PublishTakeDown = type({
  "+": "reject",
  target: "string > 0",
  "release?": "string.date.iso",
  "holding?": "string.date.iso",
});
export type PublishTakeDown = typeof PublishTakeDown.infer;

// The release and the holding of one target, by its at and its since, as a take-down covers them.
type Recorded = { release?: string; holding?: string };

/**
 * The recorded release and holding that a take-down of target acts on: each one target recorded,
 * by its at or its since. Empty when it recorded neither, so there is nothing to take down.
 * Everything that shows, asks for or checks a take-down reads what it covers through this.
 */
export function recordedFor(
  target: string,
  release: Pick<PublishRelease, "target" | "at"> | null | undefined,
  holding: Pick<PublishHolding, "target" | "since"> | null | undefined,
): Recorded {
  return {
    ...(release?.target === target ? { release: release.at } : {}),
    ...(holding?.target === target ? { holding: holding.since } : {}),
  };
}

/**
 * Whether the person's go-ahead in publish.take-down still applies to target. It must name target,
 * target must have a release or a holding recorded, and each one recorded must be the one the
 * person was shown. Everything that acts on, checks or shows a requested take-down decides it
 * through this.
 */
export function takeDownStands(
  answer: unknown,
  target: string,
  release: Pick<PublishRelease, "target" | "at"> | null | undefined,
  holding: Pick<PublishHolding, "target" | "since"> | null | undefined,
): boolean {
  const asked = parsed(PublishTakeDown(answer));
  if (asked?.target !== target) return false;
  const now = recordedFor(target, release, holding);
  return (
    (now.release !== undefined || now.holding !== undefined) &&
    (now.release === undefined || now.release === asked.release) &&
    (now.holding === undefined || now.holding === asked.holding)
  );
}

/** The values a target's take-down tool reads to decide, through takeDownAgreed, whether it may act. */
export const TAKE_DOWN_VALUES = [
  PUBLISH_TAKE_DOWN,
  PUBLISH_RELEASE,
  PUBLISH_HOLDING,
] as const;

/**
 * Whether a target's take-down tool may act, from the values TAKE_DOWN_VALUES names. The
 * coordinator starts the removal once the person agrees, but before the tool acts they may press
 * keep it, or the app may be published again.
 */
export const takeDownAgreed = (
  values: Readonly<Record<string, unknown>>,
  target: string,
) =>
  takeDownStands(
    values[PUBLISH_TAKE_DOWN],
    target,
    parsed(PublishRelease(values[PUBLISH_RELEASE])),
    parsed(PublishHolding(values[PUBLISH_HOLDING])),
  );

/**
 * The run of a target's check that the person agreed to take down what it published or holds now,
 * for defineCheck, beside publishedCheck. It passes only while takeDownStands does. A new release,
 * or a removal that cleared everything the person was shown, changes what it read, so an earlier
 * go-ahead stops counting by itself, even while something is still held. A removal that failed part
 * way can be tried again on the same go-ahead. words name the place as the person reads it.
 */
export const removableCheck =
  (
    target: string,
    words: {
      // Such as "The person has not asked to take the app down from Example Host".
      notAsked: string;
      // Such as "The person agreed to take down an earlier release on Example Host", also shown
      // when what they were shown has gone since.
      earlier: string;
    },
  ) =>
  async (view: ProjectView) => {
    const answer = await view.values(PUBLISH_TAKE_DOWN);
    const asked = parsed(PublishTakeDown(answer));
    if (asked?.target !== target) return fail(words.notAsked);
    const release = parsed(PublishRelease(await view.values(PUBLISH_RELEASE)));
    const holding = parsed(PublishHolding(await view.values(PUBLISH_HOLDING)));
    const now = recordedFor(target, release, holding);
    const evidence = [
      ...(asked.release === undefined
        ? []
        : [`agreed for the release at ${asked.release}`]),
      ...(asked.holding === undefined
        ? []
        : [`agreed for what is held since ${asked.holding}`]),
      ...(now.release === undefined ? [] : [`released at ${now.release}`]),
      ...(now.holding === undefined ? [] : [`holding since ${now.holding}`]),
    ];
    if (!takeDownStands(answer, target, release, holding))
      return fail(words.earlier, evidence);
    return pass("The person agreed to take it down", evidence);
  };

// A step of a target's own in a publish plan: its action and what the plan calls it.
type OwnStep = { action: string; title: string };

/**
 * The steps of a ready-made plan that publishes the app to target, for its steps module. The
 * target's ready check comes first, then any steps the person answers, then the publish plugin's
 * confirm for their go-ahead. Only after it come the steps that make something and the publish,
 * which need the app ready for target, and last the live check that ends the plan.
 */
export function publishSteps(plan: {
  handle: string;
  target: string;
  ready: string;
  publish: { title: string; instruction: string };
  asks?: readonly OwnStep[];
  makes?: readonly OwnStep[];
}): ReadyPlanStepBuilder[] {
  const { handle, target, asks = [], makes = [] } = plan;
  const ready = ["app_exists", `ready:${target}`];
  const own = ({ action, title }: OwnStep, requires: string[]) => ({
    plugin: target,
    action,
    title,
    requires,
  });
  return [
    own({ action: "ready", title: plan.ready }, ["app_exists"]),
    ...asks.map((step) => own(step, ["app_exists"])),
    {
      plugin: "publish",
      action: "confirm",
      title: "Confirm where your app goes",
      requires: ["app_exists"],
      input: { plan: handle },
    },
    ...makes.map((step) => own(step, ready)),
    {
      ...own({ action: "publish", title: plan.publish.title }, ready),
      input: { instruction: plan.publish.instruction },
    },
    own(
      {
        action: "live",
        title: "Confirm the saved version is the one published",
      },
      ["app_exists"],
    ),
  ];
}
