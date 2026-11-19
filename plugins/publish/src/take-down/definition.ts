import { defineScreen } from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishHolding,
  PublishRelease,
} from "@corbits-builder/plugin/publish";
import { type } from "arktype";
import { PUBLISH_GO_AHEAD } from "../go-ahead.ts";
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
  agreed: "Take it down",
  kept: "Keep it",
};

export default defineScreen({
  input: Input,
  output: Output,
  // With nothing to take down, the screen would ask for a go-ahead that removes nothing.
  validate: (_input, _data, project) =>
    PublishRelease(project[PUBLISH_RELEASE]) instanceof type.errors &&
    PublishHolding(project[PUBLISH_HOLDING]) instanceof type.errors
      ? [
          {
            field: "plan",
            problem:
              "nothing is published or held for this project, so there is nothing to take down",
          },
        ]
      : [],
  // The release and the holding as recorded. The view works out which of them the plan's target
  // made, because only the host knows each plan's take-down.
  prepare: (input, _data, project) => {
    const release = PublishRelease(project[PUBLISH_RELEASE]);
    const holding = PublishHolding(project[PUBLISH_HOLDING]);
    return {
      plan: input.plan,
      release:
        release instanceof type.errors
          ? null
          : { target: release.target, url: release.url, at: release.at },
      holding: holding instanceof type.errors ? null : holding,
    };
  },
  describe: {
    says: {
      label: () => text.title,
      chose: ({ agreed }) => (agreed === null ? text.kept : text.agreed),
    },
    summary:
      "Asks the person, before anything is removed, whether to take the app down from where the chosen plan published it: what goes and whether what people entered is kept, in the removal action's own words, with the address people open now and, for something that costs money, where it is and what it costs. The answer { agreed: { target, release?, holding? } }, with the at of the release and the since of the holding they were shown, is their go-ahead for exactly that, and { agreed: null } means they keep it. The screen records the answer itself; the plan's guidance says what follows.",
    when: "The person asks to take their app down, or to stop paying for what Builder set up for it. Every take-down needs their go-ahead from this screen first.",
    unless:
      "Nothing is published or held for the project, or the person already agreed here for what is published now.",
    fields: {
      plan: {
        about:
          "The handle of the ready-made publish plan whose place the app is taken down from: the one whose plugin publish.release or publish.holding names as its target.",
      },
    },
  },
  // Agreeing to take the app down ends any go-ahead to publish it, so a later publish asks again.
  writes: {
    [PUBLISH_TAKE_DOWN]: ({ agreed }) => agreed,
    [PUBLISH_GO_AHEAD]: ({ agreed }) => (agreed === null ? undefined : null),
  },
});
