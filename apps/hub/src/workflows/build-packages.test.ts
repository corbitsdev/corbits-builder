import { expect, test } from "bun:test";
import { assertPackageRole } from "./build-packages.ts";

test("package builds reject missing, conflicting and mismatched agent roles", () => {
  for (const tags of [
    {},
    { "writer.version": "1" },
    { "unknown.version": "1" },
    { "coder.version": "1", "writer.version": "1" },
  ])
    expect(() =>
      assertPackageRole(
        { steps: { work: { agent: { tags } } } },
        "coder",
        "coder-package",
      ),
    ).toThrow("coder-package");
  expect(() =>
    assertPackageRole(
      {
        steps: {
          one: { agent: { tags: { "coder.version": "1" } } },
          two: {
            agent: { tags: { "coder.version": "1", "writer.version": "1" } },
          },
        },
      },
      "coder",
      "coder-package",
    ),
  ).toThrow("coder-package");
  expect(() =>
    assertPackageRole(
      { steps: { work: { agent: { tags: { "coder.version": "1" } } } } },
      "coder",
      "coder-package",
    ),
  ).not.toThrow();
});
