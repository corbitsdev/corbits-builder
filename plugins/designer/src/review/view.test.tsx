import { describe, expect, test } from "bun:test";
import {
  framePins,
  NO_PINS,
  offerOf,
  outgoing,
  pinned,
  type PinEvent,
  type Pins,
  type Spot,
} from "./view.tsx";
import type { At } from "./schema.ts";

const box: [number, number, number, number] = [12, 40, 120, 32];
// Two places as the frame reports a click on them: the search link of home and a card of tickets.
const search = {
  page: "index.html",
  screen: "home",
  state: "populated",
  testid: "home-search-link",
  tag: "a",
  excerpt: "Search",
  box,
};
const card = {
  page: "index.html",
  screen: "tickets",
  state: "populated",
  testid: "ticket-summary",
  tag: "section",
  box,
};
const spot: Spot = { spot: [0.25, 0.5], point: [40, 56] };

const run = (...events: PinEvent[]): Pins => events.reduce(pinned, NO_PINS);
const comment = (at: typeof At.infer, words: string): PinEvent[] => [
  { kind: "tag", at, spot },
  { kind: "write", words },
  { kind: "add" },
];

describe("pinning a comment", () => {
  test("tagging a place puts a pin there and opens its comment", () => {
    const state = run({ kind: "tag", at: search, spot });
    expect(state.writing?.at).toEqual(search);
    expect(state.writing?.words).toBe("");
    const [pin] = framePins(state, { screen: "home", state: "populated" });
    expect(pin?.number).toBe(1);
    expect(pin?.testid).toBe("home-search-link");
    expect(pin?.spot).toEqual(spot.spot);
  });

  test("adding keeps the comment against the place exactly as the frame reported it", () => {
    const state = run(...comment(search, "  Make the search link bigger. "));
    expect(state.writing).toBeNull();
    expect(outgoing(state)).toEqual([
      { text: "Make the search link bigger.", at: search },
    ]);
  });

  test("a pin needs words before it is added", () => {
    const state = run({ kind: "tag", at: search, spot }, { kind: "add" });
    expect(state.pins).toEqual([]);
    expect(state.writing).not.toBeNull();
  });

  test("cancel takes away a pin that has no comment", () => {
    const state = run({ kind: "tag", at: search, spot }, { kind: "cancel" });
    expect(framePins(state, { screen: "home", state: "populated" })).toEqual(
      [],
    );
    expect(outgoing(state)).toEqual([]);
  });

  test("only the pins of the screen and state shown are drawn, numbered as listed", () => {
    const state = run(
      ...comment(search, "Bigger."),
      ...comment(card, "Fewer words."),
    );
    const tickets = framePins(state, { screen: "tickets", state: "populated" });
    expect(tickets.map((pin) => pin.number)).toEqual([2]);
    expect(tickets[0]?.label).toBe("Pin 2: Fewer words.");
    expect(framePins(state, { screen: "tickets", state: "empty" })).toEqual([]);
  });
});

describe("what the review offers", () => {
  test("approving and sending back carry the same comments", () => {
    const state = run(
      ...comment(search, "Bigger."),
      ...comment(card, "Fewer words."),
    );
    const comments = outgoing(state);
    const offer = offerOf(
      { files: {}, version: 2, approval: { option: "design-option-1" } },
      comments,
    );
    expect(offer.accept).toEqual({
      output: {
        decision: "approved",
        version: 2,
        option: "design-option-1",
        comments,
      },
    });
    expect(offer.sendBack).toEqual({
      decision: "changes",
      version: 2,
      comments,
    });
  });

  test("a live draft offers no approval, and says why", () => {
    const offer = offerOf(
      {
        files: {},
        version: "draft",
        approval: { unavailable: "Still drawing." },
      },
      [],
    );
    expect(offer.accept).toEqual({ unavailable: "Still drawing." });
  });

  test("words still being written are sent, and counted", () => {
    const state = run(
      ...comment(search, "Bigger."),
      {
        kind: "tag",
        at: card,
        spot,
      },
      { kind: "write", words: "Fewer words." },
    );
    expect(outgoing(state).map((said) => said.text)).toEqual([
      "Bigger.",
      "Fewer words.",
    ]);
  });
});
