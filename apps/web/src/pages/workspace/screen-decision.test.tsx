import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  validateOutput,
  type Decision,
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
import review from "@plugins/designer/src/review/definition.ts";
import { offerOf as reviewOffer } from "@plugins/designer/src/review/view.tsx";
import approve from "@plugins/writer/src/approve/definition.ts";
import {
  filedOf,
  offerOf as approveOffer,
} from "@plugins/writer/src/approve/view.tsx";
import { decisionControls, sentBack } from "./screen-question.tsx";

const box: [number, number, number, number] = [0, 0, 80, 20];
const said = (text: string) => ({
  text,
  at: { page: "index.html", screen: "home", tag: "a", box },
});
const twoComments = [said("Bigger."), said("Fewer words.")];

const declared = <In, Out, Data, Prepared>(
  screen: Screen<In, Out, Data, Prepared>,
) => {
  if (screen.decision === undefined)
    throw new Error("The screen declares no decision.");
  return screen.decision;
};

const controlsOf = <Out,>(
  decision: Decision<Out>,
  offer: Offer<Out>,
  drafted: boolean,
  accepted: unknown[] = [],
) =>
  decisionControls(decision, offer, {
    drafted,
    busy: false,
    accept: (output) => accepted.push(output),
  });

// Both screens that approve or send back, as the host controls them with nothing pending.
const screens = [
  {
    name: "the design review",
    controls: (drafted: boolean, accepted: unknown[]) =>
      controlsOf(
        declared(review),
        reviewOffer(
          { files: {}, version: 2, approval: { option: "design-option-1" } },
          [],
        ),
        drafted,
        accepted,
      ),
  },
  {
    name: "the document approval",
    controls: (drafted: boolean, accepted: unknown[]) => {
      const { filed, missing } = filedOf(
        [
          {
            kind: "build_plan",
            title: "Build plan",
            artifactId: "art-plan",
            version: 3,
          },
        ],
        ["build_plan"],
      );
      return controlsOf(
        declared(approve),
        approveOffer(filed, missing),
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

  test("keep reviewing leaves the comments to send", () => {
    const controls = controlsOf(decision, pending, false);
    expect(pressed("accept", isPending(controls)).asking).toBe("open");
    expect(pressed("keep", isPending(controls)).accepts).toBe(false);
    expect(controlsOf(decision, pending, false).pending).toBe("2 comments");
    expect(pending.sendBack?.comments).toEqual(twoComments);
  });

  test("a live draft cannot be approved, and the row says why", () => {
    const controls = controlsOf(
      decision,
      reviewOffer(
        {
          files: {},
          version: "draft",
          approval: { unavailable: "The designer is still working." },
        },
        [],
      ),
      false,
    );
    expect(controls.onAccept).toBeNull();
    expect(
      renderToStaticMarkup(
        <ScreenDecision value={controls}>
          <ScreenActions />
        </ScreenDecision>,
      ),
    ).toContain("The designer is still working.");
  });
});
