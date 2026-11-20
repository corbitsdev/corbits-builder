import {
  defineScreen,
  parsed,
  type ReadyPlanOffer,
} from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishHolding,
  PublishRelease,
  recordedFor,
  type PublishTakeDown,
} from "@corbits-builder/publish-contract";
import { PUBLISH_GO_AHEAD, PUBLISH_GROUP } from "../go-ahead.ts";
import { Input, Output } from "./schema.ts";

// The removal action's own text says what goes and what happens to what people entered, so this
// screen says only what is true of every target.
export const text = {
  title: "Take your app down?",
  address: "Its address:",
  held: (place: string) => `What Builder set up at ${place} goes too.`,
  costs: (place: string, costs: string) =>
    `${place} stops charging you ${costs}.`,
  nothing: "Nothing is published there now, so there's nothing to take down.",
  go: "Take it down",
  keep: "Keep it",
  orWrite: "Or write below what you want instead.",
};

/** What a take-down by the offered plan would remove, as the person is shown it. */
type TakenDown = {
  /** The go-ahead the person gives for exactly what they are shown. */
  agreed: PublishTakeDown;
  /** The address people open the app at, when it is published there. */
  url: string | undefined;
  /** Where something that costs money is held, and what it costs, when there is one. */
  held: { place: string; costs: string | undefined } | undefined;
};

/**
 * What taking down by the offered plan removes: the release and the holding whose target is the
 * plugin its takeDown names. Null when the plan takes nothing down or that plugin recorded neither.
 */
function takenDown(
  offered: ReadyPlanOffer | undefined,
  release: { target: string; url: string; at: string } | null,
  holding: {
    target: string;
    place: string;
    since: string;
    costs?: string | undefined;
  } | null,
): TakenDown | null {
  const target = offered?.takeDown?.plugin;
  if (target === undefined) return null;
  const recorded = recordedFor(target, release, holding);
  if (recorded.release === undefined && recorded.holding === undefined)
    return null;
  return {
    agreed: { target, ...recorded },
    url: recorded.release === undefined ? undefined : release?.url,
    held:
      recorded.holding === undefined || holding === null
        ? undefined
        : { place: holding.place, costs: holding.costs },
  };
}

export default defineScreen({
  input: Input,
  output: Output,
  // With nothing to take down, the screen would ask for a go-ahead that removes nothing.
  validate: (_input, _data, project) =>
    parsed(PublishRelease(project[PUBLISH_RELEASE])) === undefined &&
    parsed(PublishHolding(project[PUBLISH_HOLDING])) === undefined
      ? [
          {
            field: "plan",
            problem:
              "nothing is published or held for this project, so there is nothing to take down",
          },
        ]
      : [],
  // What the plan's take-down removes of what is recorded, in its action's own words.
  fromProject: ({ plan }, project) => {
    const offered = project
      .plans(PUBLISH_GROUP)
      .find(({ handle }) => handle === plan);
    return {
      shown: takenDown(
        offered,
        parsed(PublishRelease(project.value(PUBLISH_RELEASE))) ?? null,
        parsed(PublishHolding(project.value(PUBLISH_HOLDING))) ?? null,
      ),
      removes: offered?.takeDown?.removes,
    };
  },
  describe: {
    says: {
      label: () => text.title,
      chose: ({ agreed }) => (agreed === null ? text.keep : text.go),
    },
    summary:
      "Asks the person, before anything is removed, whether to take the app down from where the chosen plan published it: what goes and whether what people entered is kept, in the removal action's own words, with the address people open now and, for something that costs money, where it is and what it costs. The answer { agreed: { target, release?, holding? } }, with the at of the release and the since of the holding they were shown, is their go-ahead for exactly that, and { agreed: null } means they keep it. The screen records the answer itself; the plan's guidance says what follows.",
    when: "The person asks to take their app down, or to stop paying for what Builder set up for it. Every take-down needs their go-ahead from this screen first.",
    unless:
      "Nothing is published or held for the project, or the person already agreed here for what is published now.",
    fields: {
      plan: {
        about:
          "The handle of the ready-made publish plan whose target the app is taken down from: the one whose plugin publish.release or publish.holding names as its target.",
      },
    },
  },
  // Agreeing to take the app down ends any go-ahead to publish it, so a later publish asks again.
  writes: {
    [PUBLISH_TAKE_DOWN]: ({ agreed }) => agreed,
    [PUBLISH_GO_AHEAD]: ({ agreed }) => (agreed === null ? undefined : null),
  },
});
