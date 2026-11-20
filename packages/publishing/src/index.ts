import { type } from "arktype";
import {
  declaredProduction,
  defineValue,
  fail,
  parsed,
  pass,
  type ProjectView,
  type ReadyPlanStepBuilder,
} from "@corbits-builder/plugin";

// The group that every place and every ready-made plan that publishes the app lists, so whatever
// offers publishing finds them without naming a plugin.
export const PUBLISH_GROUP = "publish";

// The action every place names its removal by, so a take-down adds it without naming a plugin.
export const REMOVE_ACTION = "remove";

// A release as a place records it. url is the address people open, version is the saved app's
// version that was published, as a check reads it, and at is when it went out, as an ISO time.
// replaceable is false when the next publish to the same place cannot update this release, as when
// it went to an account the person does not hold yet. That publish makes a new app at a new
// address, and this one keeps the earlier version.
export const PublishRelease = type({
  "+": "reject",
  target: "string > 0",
  url: type("string.url").and(/^https?:\/\//),
  version: "string > 0",
  at: "string.date.iso",
  "replaceable?": "false",
});
export type PublishRelease = typeof PublishRelease.infer;

export const RELEASE = defineValue(
  "publish.release",
  PublishRelease,
  'Where the project\'s app was last published, as { "target": the plugin that published it, such as server, "url": the address people open it at, "version": the saved app\'s version that went out, "at": when, as an ISO time, and "replaceable": false when the next publish there makes a new address rather than updating it }; null once it was taken down or is gone, and none while it was never published.',
);

export const PLAN = defineValue(
  "publish.plan",
  type("string > 0"),
  "The handle of the ready-made publish plan the person chose to publish the app by, such as publish-to-server; none while they never chose, as when only one is installed.",
);

// The keep link as a place records it. until is when, as an ISO time, the link stops working and
// the app is removed unless kept. place is the plain name of the place the app went to, where the
// person makes an account to keep it.
export const PublishKeep = type({
  "+": "reject",
  link: type("string.url").and(/^https:\/\//),
  until: "string.date.iso",
  place: "string > 0",
});
export type PublishKeep = typeof PublishKeep.infer;

// Private because the link works like a password.
export const KEEP = defineValue(
  "publish.keep",
  PublishKeep,
  'The link the person opens to keep an app that was published without an account at its host, until when, and where it was published, as { "link": the link, "until": an ISO time, "place": the plain name of the host, such as Cloudflare }; none while there is nothing to keep. Only a place\'s own tool sets it, and the person clears it once they kept the app or it is gone.',
  { private: true },
);

// What a place holds that costs money, as it records it. place is the plain name of where it is,
// such as "Example Host". since is when it was made, as an ISO time. costs, when the place knows
// it, is the price as the person reads it, such as "$6 a month".
export const PublishHolding = type({
  "+": "reject",
  target: "string > 0",
  place: "string > 0",
  since: "string.date.iso",
  "costs?": "string > 0",
});
export type PublishHolding = typeof PublishHolding.infer;

export const HOLDING = defineValue(
  "publish.holding",
  PublishHolding,
  'Something that costs money that a place made for the project, such as a server it rented, as { "target": the plugin that made it, such as digitalocean, "place": the plain name of where it is, "since": when it was made, as an ISO time, and "costs": what it costs, as the person reads it, such as $6 a month }; none while nothing is held. Only that place\'s own tools set it, and clear it once the thing is gone; the person may also clear it once they removed it themselves.',
);

// A go-ahead to take down, as the publish screen records it. release and holding are the at of the
// release and the since of the holding that the person was shown, so the go-ahead covers only
// those. Either is absent when the place had none recorded.
const PublishTakeDown = type({
  "+": "reject",
  target: "string > 0",
  "release?": "string.date.iso",
  "holding?": "string.date.iso",
});

export const TAKE_DOWN = defineValue(
  "publish.take-down",
  PublishTakeDown,
  'The person\'s go-ahead to take down what a place published or holds, as { "target": the plugin that published or holds it, "release": the at of the release they were shown, "holding": the since of the holding they were shown, each as an ISO time and left out when there was none }; null once they gave their go-ahead to publish again.',
);

// The release and the holding of one place, by its at and its since, as a take-down covers them.
type Recorded = { release?: string; holding?: string };

/**
 * The recorded release and holding that a take-down of target acts on: each one target recorded,
 * by its at or its since. Empty when it recorded neither, so there is nothing to take down.
 */
export function recordedFor(
  target: string,
  released: Pick<PublishRelease, "target" | "at"> | null | undefined,
  held: Pick<PublishHolding, "target" | "since"> | null | undefined,
): Recorded {
  const recorded: Recorded = {};
  if (released?.target === target) recorded.release = released.at;
  if (held?.target === target) recorded.holding = held.since;
  return recorded;
}

/**
 * What a place records once what it published and held is gone: null for the release and the
 * holding target recorded, and for each of also, the place's own values that go with them.
 */
export function clearedFor(
  target: string,
  values: Readonly<Record<string, unknown>>,
  also: readonly string[] = [],
): Record<string, null> {
  const recorded = recordedFor(
    target,
    parsed(PublishRelease(values[RELEASE.name])),
    parsed(PublishHolding(values[HOLDING.name])),
  );
  const cleared: Record<string, null> = {};
  if (recorded.release !== undefined) cleared[RELEASE.name] = null;
  if (recorded.holding !== undefined) cleared[HOLDING.name] = null;
  for (const name of also) cleared[name] = null;
  return cleared;
}

/**
 * Whether the person's go-ahead to take down still applies to target. It must name target, target
 * must have a release or a holding recorded, and each one recorded must be the one the person was
 * shown.
 */
export function takeDownStands(
  answer: unknown,
  target: string,
  released: Pick<PublishRelease, "target" | "at"> | null | undefined,
  held: Pick<PublishHolding, "target" | "since"> | null | undefined,
): boolean {
  const asked = parsed(PublishTakeDown(answer));
  if (asked?.target !== target) return false;
  const now = recordedFor(target, released, held);
  return (
    (now.release !== undefined || now.holding !== undefined) &&
    (now.release === undefined || now.release === asked.release) &&
    (now.holding === undefined || now.holding === asked.holding)
  );
}

/** The values a place's take-down tool reads to decide, through takeDownAgreed, whether it may act. */
export const TAKE_DOWN_VALUES = [TAKE_DOWN.name, RELEASE.name, HOLDING.name];

/**
 * Whether a place's take-down tool may act, from the values TAKE_DOWN_VALUES names. The coordinator
 * starts the removal once the person agrees, but before the tool acts the app may be published
 * again.
 */
export const takeDownAgreed = (
  values: Readonly<Record<string, unknown>>,
  target: string,
) =>
  takeDownStands(
    values[TAKE_DOWN.name],
    target,
    parsed(PublishRelease(values[RELEASE.name])),
    parsed(PublishHolding(values[HOLDING.name])),
  );

/**
 * The run of a place's check that the app it published is the saved one, for defineCheck. It
 * compares the release the place recorded with the saved app's version and never contacts the
 * place, so it says what was published, not that the place still serves it. words name the place.
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
    const recorded = await view.value(RELEASE);
    if (saved === undefined) return fail("The project has no saved app");
    if (recorded === undefined || recorded.target !== target)
      return fail(words.notPublished);
    if (recorded.version !== saved)
      return fail(words.earlier, [
        `published ${recorded.version} at ${recorded.at}`,
        `saved ${saved}`,
      ]);
    return pass(`The saved app is published at ${recorded.url}`, [
      `published ${recorded.version} at ${recorded.at}`,
    ]);
  };

/**
 * The run of a place's check that the person agreed to take down what it published or holds now,
 * for defineCheck. It passes only while takeDownStands does, so a new release, or a removal that
 * cleared everything the person was shown, ends an earlier go-ahead by itself. A removal that failed
 * part way can be tried again on the same go-ahead.
 */
export const removableCheck =
  (
    target: string,
    words: {
      // Such as "The person has not asked to take the app down from Example Host".
      notAsked: string;
      // Such as "The person agreed to take down an earlier release on Example Host".
      earlier: string;
    },
  ) =>
  async (view: ProjectView) => {
    const asked = await view.value(TAKE_DOWN);
    if (asked === undefined || asked.target !== target)
      return fail(words.notAsked);
    const released = await view.value(RELEASE);
    const held = await view.value(HOLDING);
    const now = recordedFor(target, released, held);
    const evidence = [
      asked.release && `agreed for the release at ${asked.release}`,
      asked.holding && `agreed for what is held since ${asked.holding}`,
      now.release && `released at ${now.release}`,
      now.holding && `holding since ${now.holding}`,
    ].filter((line) => line !== undefined);
    if (!takeDownStands(asked, target, released, held))
      return fail(words.earlier, evidence);
    return pass("The person agreed to take it down", evidence);
  };

/**
 * The run of a place's check that the saved app says how it runs in production, for defineCheck. It
 * reads the same value a publish reads, so a pass means the publish can use it. words name what is
 * missing as the place needs it.
 */
export const productionCheck =
  (words: {
    // Such as "The app does not say how it runs in production".
    notDeclared: string;
  }) =>
  async (view: ProjectView) => {
    const production = declaredProduction({
      "stack.production": await view.values("stack.production"),
    });
    if (production === undefined)
      return fail(words.notDeclared, [
        "the project's stack.production is not set",
      ]);
    if (production instanceof type.errors)
      return fail("The app's production settings cannot be used", [
        production.summary,
      ]);
    return pass("The app says how it runs in production", [
      "it says how it installs, builds and starts",
      `it answers on the port in ${production.port}`,
      production.data.length === 0
        ? "it keeps no data between releases"
        : `it keeps ${production.data.join(", ")} between releases`,
    ]);
  };

/**
 * The status a published address answers with when visited from where the tools run, or undefined
 * when nothing answers within ten seconds. It follows no redirect, so a redirect is an answer.
 */
export async function visit(url: string, signal: AbortSignal) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    });
    await response.body?.cancel();
    return response.status;
  } catch (error) {
    if (signal.aborted) throw error;
    return undefined;
  }
}

/**
 * The steps every publish plan for one place takes: check the app is ready, the place's own steps,
 * publish once the person's go-ahead stands, and confirm the saved version is the one published.
 */
export const publishSteps = ({
  place,
  ready,
  publish,
  own = [],
}: {
  place: string;
  ready: string;
  publish: { title: string; instruction: string };
  own?: readonly ReadyPlanStepBuilder[];
}): ReadyPlanStepBuilder[] => [
  { plugin: place, action: "ready", title: ready, requires: ["app_exists"] },
  ...own,
  {
    plugin: place,
    action: "publish",
    title: publish.title,
    requires: ["app_exists", `ready:${place}`, "agreed:publish"],
    input: { instruction: publish.instruction },
  },
  {
    plugin: place,
    action: "live",
    title: "Confirm the saved version is the one published",
    requires: ["app_exists"],
  },
];
