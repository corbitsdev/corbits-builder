import { describe, expect, test } from "bun:test";
import { type } from "arktype";
import { defineScreen, placeScreen, screenPlacement } from "./index.ts";

const base = () =>
  defineScreen({
    input: type({ "+": "reject" }),
    output: type({ "+": "reject" }),
    describe: {
      summary: "Test screen",
      when: "testing",
      unless: "not testing",
      fields: {},
    },
  });

describe("screen placement", () => {
  test("defaults to a medium card in the prompt box", () => {
    const placement = placeScreen("test screen", base());
    expect(placement).toEqual({
      mainPane: false,
      promptBox: { size: "md" },
      entries: [],
    });
    expect(screenPlacement(base())).toEqual(placement);
  });

  test("derives main-pane, prompt-box and entry places from declared places", () => {
    const status = () => ({ label: "Ready" });
    const screen = defineScreen({
      ...base(),
      state: () => ({ ok: true }),
      places: { "main-pane": {}, "top-right": { status } },
    });
    const placement = placeScreen("test screen", screen);
    expect(placement.mainPane).toBe(true);
    expect(placement.promptBox).toBeNull();
    expect(placement.entries).toEqual([{ place: "top-right", status }]);
  });

  test("refuses invalid place combinations and legacy fields", () => {
    expect(() => placeScreen("test screen", { ...base(), places: {} })).toThrow(
      "places the screen nowhere",
    );
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        places: { "main-pane": {} },
      }),
    ).toThrow("waits in the prompt box");
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        places: { "main-pane": {}, "prompt-box": { size: "md" } },
      }),
    ).toThrow("in the main pane and as a card");
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        places: { "prompt-box": { size: "sm" } },
      }),
    ).toThrow("needs a main-pane");
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        state: () => ({}),
        places: { "main-pane": {}, "prompt-box": { size: "sm" } },
      }),
    ).toThrow("screen with a state never asks");
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        state: () => ({}),
        places: { "top-right": { status: () => ({ label: "x" }) } },
      }),
    ).toThrow("needs a state and a main-pane");
    expect(() =>
      placeScreen("test screen", {
        ...base(),
        render: "inline-chat",
      } as never),
    ).toThrow("now goes under places");
  });
});
