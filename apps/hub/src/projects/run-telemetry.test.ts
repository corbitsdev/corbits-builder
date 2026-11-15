import { expect, test } from "bun:test";
import { runPackageVersion } from "./run-telemetry.ts";

test("uses the deployed package version retained in the run, including its content hash", () => {
  expect(
    runPackageVersion({
      closure: {
        topLevel: [
          { name: "coordinator-native", version: "0.34.0-sha-12345678" },
        ],
      },
    }),
  ).toBe("0.34.0-sha-12345678");
});

test("returns nothing for a bundle of the wrong shape", () => {
  expect(runPackageVersion({})).toBeUndefined();
});
