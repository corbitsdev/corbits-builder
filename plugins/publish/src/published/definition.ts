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
  // doing is what the publish is at now, as its running step last said.
  | { is: "publishing"; doing: string | undefined }
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
    changes: "You have changes to publish",
    failed: "Something went wrong",
    "taking-down": "Taking it down…",
    "taken-down": "Taken down",
  },
  failed: {
    publish: "The last publish did not finish.",
    "take-down": "Taking it down did not finish.",
  },
  publishing:
    "This can take a few minutes. If Builder needs you, it asks in the conversation.",
  changes: "People still see the version from before your latest changes.",
  places: "Where to publish",
  publish: "Publish",
  publishChanges: "Publish changes",
  again: "Try again",
  publishedAt: (at: string) => `Published ${new Date(at).toLocaleString()}`,
  newAddress: "Publishing again gives it a new address until you keep it.",
  hosted: (place: string, costs: string | undefined) =>
    costs === undefined
      ? `Hosted on ${place}.`
      : `Hosted on ${place}, ${costs}.`,
  keep: {
    lead: (place: string, until: string) =>
      `To keep it, make an account at ${place} before ${new Date(until).toLocaleString()}.`,
    passed: (place: string) =>
      `The time to keep it at ${place} has passed, so it may be gone.`,
    open: "Keep it",
    kept: "I kept it",
  },
  takeDown: {
    ask: "Take it down",
    sure: "Take your app down?",
    removes: "People can no longer open it.",
    costs: (place: string, costs: string) =>
      `${place} stops charging you ${costs}.`,
    yes: "Yes, take it down",
    no: "Keep it up",
  },
  gone: "It's already gone",
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
 * or a take-down that cleared it. The plan adds that the work behind the first two failed, and that a
 * publish's runs have not ended yet.
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
  // A publish is under way from the person's go-ahead until its release is recorded and its plan's
  // runs have ended.
  const given = project.value(GO_AHEAD);
  const running = project.plan.find(
    (step) =>
      given !== undefined &&
      step.plan === given.plan &&
      step.state === "running",
  );
  if (
    given !== undefined &&
    (goAheadLapsed(given, project.value(PLAN), released) === undefined ||
      running !== undefined)
  ) {
    const publish = failed((step) => step.plan === given.plan);
    return publish === undefined
      ? { is: "publishing", doing: running?.summary }
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
