import { describe, expect, test } from "bun:test";
import {
  choiceOnGone,
  choiceOnTab,
  coverOf,
  NO_CHOICE,
  type SpaceChoice,
} from "./overlay.ts";

const review = { key: "screen:designer review", shows: "design" };
const closed: SpaceChoice = { kind: "closed", key: review.key };
const opened: SpaceChoice = { kind: "opened" };

describe("coverOf", () => {
  test("with nothing open, the conversation is in sight", () => {
    expect(
      coverOf({
        projectOpen: false,
        space: null,
        choice: NO_CHOICE,
        paneShown: null,
      }),
    ).toEqual({ kind: "chat" });
  });

  test("a screen covers the conversation until the person closes it", () => {
    const base = { projectOpen: false, space: review, paneShown: null };
    expect(coverOf({ ...base, choice: NO_CHOICE })).toEqual({
      kind: "space",
      over: "chat",
    });
    expect(coverOf({ ...base, choice: closed })).toEqual({ kind: "chat" });
  });

  test("closing one screen leaves the next to cover the conversation", () => {
    expect(
      coverOf({
        projectOpen: false,
        space: { key: "screen:other", shows: null },
        choice: closed,
        paneShown: null,
      }),
    ).toEqual({ kind: "space", over: "chat" });
  });

  test("over the project view a screen waits for Open", () => {
    const base = { projectOpen: true, space: review, paneShown: "files" };
    expect(coverOf({ ...base, choice: NO_CHOICE })).toEqual({
      kind: "project",
    });
    expect(coverOf({ ...base, choice: opened })).toEqual({
      kind: "space",
      over: "project",
    });
  });

  test("a screen stands in for the tab it shows more of", () => {
    const base = { projectOpen: true, space: review, paneShown: "design" };
    expect(coverOf({ ...base, choice: NO_CHOICE })).toEqual({
      kind: "space",
      over: "tab",
    });
    expect(coverOf({ ...base, choice: closed })).toEqual({ kind: "project" });
  });
});

describe("choices", () => {
  test("the tab a screen shows more of brings it back after it was closed", () => {
    expect(choiceOnTab(closed, review, "design")).toEqual(NO_CHOICE);
    expect(choiceOnTab(opened, review, "design")).toEqual(opened);
  });

  test("any other tab puts away a screen opened from the box", () => {
    expect(choiceOnTab(opened, review, "files")).toEqual(NO_CHOICE);
    expect(choiceOnTab(closed, review, "files")).toEqual(closed);
  });

  test("with no screen left, an opened one is put away and a closed one stays closed", () => {
    expect(choiceOnGone(opened)).toEqual(NO_CHOICE);
    expect(choiceOnGone(closed)).toEqual(closed);
  });
});
