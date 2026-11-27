import { describe, expect, test } from "bun:test";
import type { ProjectRead } from "@corbits-builder/plugin";
import { PUBLISH_RELEASE } from "@corbits-builder/publish-contract";
import { PUBLISH_GROUP } from "../go-ahead.ts";
import { publishState } from "./state.ts";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function project(input: {
  facts?: readonly string[];
  values?: Record<string, unknown>;
}): ProjectRead {
  return {
    value: (name) => input.values?.[name] ?? null,
    facts: new Set(input.facts ?? []),
    plan: [],
    planned: [],
    now: NOW,
    app: { version: "abc1234" },
    coordinator: { working: false, since: undefined },
    runs: [],
    asking: [],
    plans: (group) =>
      group === PUBLISH_GROUP
        ? [
            {
              handle: "publish-to-host",
              about: "Publishes the app.",
              groups: [PUBLISH_GROUP],
              plugins: ["host"],
              ends: "published",
            },
          ]
        : [],
  };
}

describe("publish state", () => {
  test("a saved app the coder is still building offers no publish", () => {
    expect(publishState(project({}))).toBeUndefined();
  });

  test("an app filed after its checks offers to publish it", () => {
    expect(publishState(project({ facts: ["app_exists"] }))?.state).toEqual({
      state: "unpublished",
    });
  });

  test("an app already released keeps its status while nothing is filed", () => {
    const shown = publishState(
      project({
        facts: ["published"],
        values: {
          [PUBLISH_RELEASE]: {
            target: "host",
            url: "https://example.test",
            version: "abc1234",
            at: "2026-11-26T11:00:00.000Z",
          },
        },
      }),
    );
    expect(shown?.state.state).toBe("published");
  });
});
