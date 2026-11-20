import {
  defineScreen,
  type ProjectRead,
  type ReadyPlanOffer,
} from "@corbits-builder/plugin";
import {
  HOLDING,
  KEEP,
  PLAN,
  PUBLISH_GROUP,
  RELEASE,
  REMOVE_ACTION,
  TAKE_DOWN,
  takeDownStands,
} from "@corbits-builder/publishing";
import { type } from "arktype";
import { GO_AHEAD, goAheadLapsed } from "../go-ahead.ts";

// What is published, held and kept, as the values record it, the plan publishing again uses, and
// what taking it down removes, in the words of the place that published it.
export type Where = {
  plan: string | undefined;
  removes: string | undefined;
  release: { url: string; at: string; replaceable: boolean } | undefined;
  holding: { place: string; costs: string | undefined } | undefined;
  // passed once the time to keep it is over, as of when the hub read it.
  keep:
    | { link: string; until: string; place: string; passed: boolean }
    | undefined;
};

/** Where publishing the app stands, as the publish screen draws it. */
export type Shown =
  | { is: "never" | "taken-down"; offer: Offer }
  | { is: "publishing" }
  // changes: the saved app is newer than the one published.
  | { is: "published" | "changes" | "taking-down"; where: Where }
  | {
      is: "failed";
      doing: "publish" | "take-down";
      why: string | undefined;
      where: Where;
    };

// Where the app can go, and the place to publish to: the one the person chose, else the only one.
type Offer = { places: readonly ReadyPlanOffer[]; chosen: string | undefined };

export const text = {
  label: "Publish",
  title: {
    never: "Not published yet",
    publishing: "Publishing…",
    published: "Published",
    changes: "Published",
    "taking-down": "Taking it down…",
    "taken-down": "Taken down",
  },
  failed: {
    publish: "Publish didn't finish",
    "take-down": "Take-down didn't finish",
  },
  places: "Where to publish",
  publish: "Publish",
  publishChanges: "Publish changes",
  again: "Try again",
  publishedAt: (ago: string) => `Published ${ago}`,
  newAddress: "Gets a new address until you keep it.",
  hosted: (place: string, costs: string | undefined) =>
    costs === undefined ? place : `${place}, ${costs}`,
  keep: {
    open: (place: string) => `Keep it at ${place}`,
    until: (until: string) =>
      `before ${new Date(until).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    passed: (place: string) => `Not kept at ${place} in time.`,
    kept: "I kept it",
  },
  takeDown: {
    ask: "Take it down",
    sure: "Take your app down?",
    removes: "People can no longer open it.",
    costs: (place: string, costs: string) =>
      `${place} stops charging you ${costs}.`,
    yes: "Take it down",
    no: "Keep it up",
  },
  gone: "Mark as gone",
};

function offerOf(project: ProjectRead): Offer {
  const places = project.plans(PUBLISH_GROUP);
  const only = places.length === 1 ? places[0]?.handle : undefined;
  return { places, chosen: project.value(PLAN) ?? only };
}

export const whereOf = (project: ProjectRead): Where => {
  const released = project.value(RELEASE);
  const held = project.value(HOLDING);
  const kept = project.value(KEEP);
  const target = released?.target ?? held?.target;
  return {
    plan: offerOf(project).chosen,
    removes:
      target === undefined ? undefined : project.confirm(target, REMOVE_ACTION),
    release: released && {
      url: released.url,
      at: released.at,
      replaceable: released.replaceable !== false || kept === undefined,
    },
    holding: held && { place: held.place, costs: held.costs },
    keep: kept && {
      link: kept.link,
      until: kept.until,
      place: kept.place,
      passed: Date.parse(kept.until) <= Date.now(),
    },
  };
};

/**
 * Where publishing stands, from what the values record: a take-down the person agreed to, a publish
 * they agreed to that has not gone out, what is published or held and whether the saved app is newer,
 * or a take-down that cleared it. The plan adds that the work behind the first two failed.
 */
export function shownOf(project: ProjectRead): Shown | undefined {
  const released = project.value(RELEASE);
  const held = project.value(HOLDING);
  if (!project.facts.has("app_exists") && !released && !held) return undefined;
  const target = released?.target ?? held?.target;
  const asked = project.value(TAKE_DOWN);
  const failed = (matches: (step: ProjectRead["plan"][number]) => boolean) =>
    project.plan.find((step) => matches(step) && step.state === "failed");
  if (target !== undefined && takeDownStands(asked, target, released, held)) {
    const removal = failed(
      (step) => step.plugin === target && step.action === REMOVE_ACTION,
    );
    return removal === undefined
      ? { is: "taking-down", where: whereOf(project) }
      : {
          is: "failed",
          doing: "take-down",
          why: removal.summary,
          where: whereOf(project),
        };
  }
  // The app is live once its release is recorded, even while the publisher's run carries on.
  const given = project.value(GO_AHEAD);
  if (
    given !== undefined &&
    goAheadLapsed(given, project.value(PLAN), released) === undefined
  ) {
    const publish = failed((step) => step.plan === given.plan);
    return publish === undefined
      ? { is: "publishing" }
      : {
          is: "failed",
          doing: "publish",
          why: publish.summary,
          where: whereOf(project),
        };
  }
  const behind =
    released !== undefined &&
    project.appVersion !== undefined &&
    released.version !== project.appVersion;
  if (released || held)
    return { is: behind ? "changes" : "published", where: whereOf(project) };
  return {
    is: asked === undefined ? "never" : "taken-down",
    offer: offerOf(project),
  };
}

const Nothing = type({ "+": "reject" });

export default defineScreen({
  render: "plugin-bar",
  state: shownOf,
  input: Nothing,
  output: Nothing,
  describe: {
    says: { label: () => text.label },
    summary:
      "Shows the person where their app is published, what it costs and how to keep it, with Publish and Take it down on the screen itself. It shows by itself once the project has an app.",
    when: "Never open it: it is always beside the plan once the project has an app.",
    unless: "Always: it shows by itself.",
    fields: {},
  },
});
