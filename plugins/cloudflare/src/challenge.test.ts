import { expect, test } from "bun:test";
import { solvable, solve } from "./challenge.ts";

test("a challenge that is not whole positive numbers, asks too much work or too long a proof, or has a short seed is not solved", async () => {
  const seed = Buffer.alloc(32, 1).toString("base64url");
  for (const work of [
    { seed, k: 0, g: 10 },
    { seed, k: 10, g: 1.5 },
    { seed, k: 8_001, g: 8_000 },
    // Little hashing, but a proof of gigabytes.
    { seed, k: 64_000_000, g: 1 },
    { seed: Buffer.alloc(16).toString("base64url"), k: 1, g: 1 },
  ]) {
    expect(solvable(work)).toBe(false);
    await expect(solve(work)).rejects.toThrow("challenge_unsolvable");
  }
  expect(solvable({ seed, k: 8_000, g: 2_000 })).toBe(true);
});
