import { describe, expect, test } from "bun:test";
import { withEntries } from "./session-memory.ts";

const first = () => true;
const equal = (left: number, right: number) => left === right;

describe("withEntries", () => {
  test("learning nothing keeps the same map", () => {
    const known = new Map([["a", 1]]);
    expect(withEntries(known, [["a", 1]], equal)).toBe(known);
    expect(withEntries(known, [], equal)).toBe(known);
  });

  test("a new entry makes a new map and leaves the old one as it was", () => {
    const known = new Map([["a", 1]]);
    const grown = withEntries(known, [["b", 2]], equal);
    expect([...grown]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect([...known]).toEqual([["a", 1]]);
  });

  test("a changed entry replaces the kept one", () => {
    const known = new Map([["a", 1]]);
    expect(withEntries(known, [["a", 3]], equal).get("a")).toBe(3);
  });

  test("keeping the first sighting ignores later ones", () => {
    const known = new Map([["a", 1]]);
    expect(withEntries(known, [["a", 3]], first)).toBe(known);
  });
});
