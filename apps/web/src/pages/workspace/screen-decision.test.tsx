import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  placesOf,
  validateOutput,
  type Offer,
  type Screen,
} from "@corbits-builder/plugin";
import {
  isPending,
  pressed,
  ScreenActions,
  ScreenDecision,
  type DecisionControls,
} from "@corbits-builder/plugin-ui/screen-actions";
import review, {
  offerOf as reviewOffer,
} from "@plugins/designer/src/review/definition.ts";
import approve from "@plugins/writer/src/approve/definition.ts";
import { decisionControls, sentBack } from "./screen-question.tsx";

const box: [number, number, number, number] = [0, 0, 80, 20];
const said = (text: string) => ({
  text,
  at: { page: "index.html", screen: "home", tag: "a", box },
});
const twoComments = [said("Bigger."), said("Fewer words.")];

const declared = <In, Out, Data, Prepared, Resources>(
  screen: Screen<In, Out, Data, Prepared, Resources>,
) => {
  const decision = placesOf(screen)["prompt-box"]?.decision;
  if (decision === undefined)
    throw new Error("The screen declares no decision.");
  return decision;
};

const controlsOf = <Out,>(
  decision: Parameters<typeof decisionControls<Out>>[0],
  offer: Offer<Out> | undefined,
  drafted: boolean,
  accepted: unknown[] = [],
) =>
  decisionControls(decision, offer, {
    drafted,
    accept: (output) => accepted.push(output),
  });

// Both screens that approve or send back, as the host controls them with nothing pending.
const screens = [
  {
    name: "the design review",
    controls: (drafted: boolean, accepted: unknown[]) => {
      const decision = declared(review);
      return controlsOf(
        decision,
        decision.offer({
          input: {},
          data: {},
          resources: {
            design: {
              files: {},
              version: 2,
              approval: { option: "design-option-1" },
            },
          },
          draft: {},
        }),
        drafted,
        accepted,
      );
    },
  },
  {
    name: "the document approval",
    controls: (drafted: boolean, accepted: unknown[]) => {
      const decision = declared(approve);
      return controlsOf(
        decision,
        decision.offer({
          input: { kinds: ["build_plan"] },
          data: { kinds: ["build_plan"] },
          resources: {
            documents: {
              list: [
                {
                  kind: "build_plan",
                  title: "Build plan",
                  artifactId: "art-plan",
                  version: 3,
                },
              ],
            },
          },
          draft: {},
        }),
        drafted,
        accepted,
      );
    },
  },
];

const labels = (controls: DecisionControls) =>
  [
    ...renderToStaticMarkup(
      <ScreenDecision value={controls}>
        <ScreenActions />
      </ScreenDecision>,
    ).matchAll(/<button[^>]*>([^<]*)<\/button>/g),
  ].map(([, label]) => label);

/** Presses accept as the shared control does, then confirms if it asks: whether accepting took a second press. */
const approveThrough = (controls: DecisionControls) => {
  const first = pressed("accept", isPending(controls));
  if (first.accepts) {
    controls.onAccept?.();
    return false;
  }
  expect(first.asking).toBe("open");
  if (pressed("confirm", isPending(controls)).accepts) controls.onAccept?.();
  return true;
};

describe.each(screens)("$name", ({ controls: controlsFor }) => {
  test("with nothing pending and nothing typed, approve is the action and asks nothing", () => {
    const accepted: unknown[] = [];
    const controls = controlsFor(false, accepted);
    expect(labels(controls)).toEqual(["Approve"]);
    expect(approveThrough(controls)).toBe(false);
    expect(accepted).toHaveLength(1);
  });

  test("with words typed, approving takes the confirmation, and keep reviewing approves nothing", () => {
    const accepted: unknown[] = [];
    const controls = controlsFor(true, accepted);
    expect(labels(controls)).toEqual(["Approve anyway"]);
    expect(pressed("keep", isPending(controls))).toEqual({
      accepts: false,
      asking: "kept",
    });
    expect(accepted).toEqual([]);
    expect(approveThrough(controls)).toBe(true);
    expect(accepted).toHaveLength(1);
  });
});

describe("the design review's comments", () => {
  const decision = declared(review);
  const pending = reviewOffer(
    { files: {}, version: 2, approval: { option: "design-option-1" } },
    twoComments,
  );

  test("pinned comments with nothing typed make send the way forward, and approving asks first", () => {
    const accepted: unknown[] = [];
    const controls = controlsOf(decision, pending, false, accepted);
    expect(controls.pending).toBe("2 comments");
    expect(labels(controls)).toEqual(["Approve anyway"]);
    expect(approveThrough(controls)).toBe(true);
    expect(accepted).toEqual([
      {
        decision: "approved",
        version: 2,
        option: "design-option-1",
        comments: twoComments,
      },
    ]);
  });

  test("send with nothing typed sends the comments alone; with words, the words as its note", () => {
    const note = decision.sendBack?.note;
    if (note === undefined || pending.sendBack === undefined)
      throw new Error("The review sends back no output.");
    const alone = validateOutput(
      "designer review",
      review,
      sentBack(note, pending.sendBack, undefined),
    );
    const noted = validateOutput(
      "designer review",
      review,
      sentBack(note, pending.sendBack, "Try a darker blue."),
    );
    if (!alone.ok || !noted.ok) throw new Error("The feedback was refused.");
    expect(alone.output).toEqual({
      decision: "changes",
      version: 2,
      comments: twoComments,
    });
    expect(noted.output.comments).toEqual(twoComments);
    expect(noted.output.message).toBe("Try a darker blue.");
  });
});
