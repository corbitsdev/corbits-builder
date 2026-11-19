import { expect, test } from "bun:test";
import {
  changesAt,
  HAND_OFF_MS,
  publishState,
  type PublishKeepNotice,
  type PublishRecords,
} from "./publish-state.ts";

// Where publishing stands, without the keep link over it.
const stateOf = (records: PublishRecords) => publishState(records)?.state;

const FACT = "published:server";
// A run of the server's publish action, as the coordinator records it.
const PUBLISHER = { plugin: "server", action: "publish" };
const PLAN = "publish-to-server";
const release = {
  target: "server",
  url: "http://203.0.113.7",
  version: "abc123",
  at: "2026-11-17T10:00:00.000Z",
};
// The live check that ran once the release went out.
const passed = {
  result: "pass" as const,
  current: true,
  returns: [FACT],
  createdAt: "2026-11-17T10:01:00.000Z",
};
// The same record once a newer version of the app was saved.
const lapsed = { ...passed, current: false };

const records = (change: Partial<PublishRecords> = {}): PublishRecords => ({
  savedApp: true,
  ends: [FACT],
  checks: [],
  release: undefined,
  holding: undefined,
  takeDown: undefined,
  takeDowns: [],
  runs: [],
  asking: false,
  plans: [PLAN],
  plan: [],
  working: false,
  pressed: null,
  acted: null,
  ranUntil: null,
  keep: undefined,
  now: Date.parse("2026-11-17T10:08:00.000Z"),
  ...change,
});

// The publish plan's group on the project's plan, standing where the hub worked it out.
const group = (state: string) => [
  { state: "done" },
  { plan: "build-web-app", state: "not_started" },
  { plan: PLAN, state },
];

test("there is nothing to publish without a saved app", () => {
  expect(publishState(records({ savedApp: false }))).toBeNull();
});

test("there is nothing to publish with when no publish plan is installed", () => {
  expect(publishState(records({ ends: [] }))).toBeNull();
});

test("a saved app never published can be published", () => {
  expect(stateOf(records())).toEqual({ state: "unpublished" });
});

test("an app taken down can be published again", () => {
  expect(stateOf(records({ release: null }))).toEqual({
    state: "unpublished",
  });
});

test("a publishing run at work is publishing", () => {
  expect(
    stateOf(
      records({
        runs: [
          {
            ...PUBLISHER,
            status: "running",
            startedAt: "2026-11-17T11:00:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "publishing" });
});

test("an open publish question needs the person, even while a run waits on it", () => {
  expect(
    stateOf(
      records({
        asking: true,
        runs: [
          {
            ...PUBLISHER,
            status: "running",
            startedAt: "2026-11-17T11:00:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "needsYou" });
});

test("a release whose fact holds is published at its address", () => {
  expect(stateOf(records({ release, checks: [passed] }))).toEqual({
    state: "published",
    url: release.url,
    at: release.at,
  });
});

test("a skipped check holds its fact as a pass does", () => {
  expect(
    stateOf(records({ release, checks: [{ ...passed, result: "skipped" }] })),
  ).toMatchObject({ state: "published" });
});

test("a release whose fact lapsed after a newer save has changes to publish", () => {
  expect(stateOf(records({ release, checks: [lapsed] }))).toEqual({
    state: "changes",
    url: release.url,
    at: release.at,
  });
  expect(
    stateOf(records({ release, checks: [{ ...passed, result: "fail" }] })),
  ).toMatchObject({ state: "changes" });
});

test("a published app with a newer save has changes to publish, not a publish under way, whatever is at work", () => {
  // The plan's live step stands not started again once its fact lapsed.
  for (const working of [false, true])
    expect(
      stateOf(
        records({
          release,
          checks: [lapsed],
          plan: group("not_started"),
          working,
        }),
      ),
    ).toEqual({ state: "changes", url: release.url, at: release.at });
});

test("a publish of the newer save is under way from its first publishing run, and stalls once nothing works on it", () => {
  const again = {
    ...release,
    version: "def456",
    at: "2026-11-17T11:02:00.000Z",
  };
  const run = {
    ...PUBLISHER,
    status: "completed" as const,
    startedAt: "2026-11-17T11:00:00.000Z",
    endedAt: "2026-11-17T11:03:00.000Z",
  };
  const republish = (working: boolean) =>
    records({
      release: again,
      checks: [lapsed],
      plan: group("not_started"),
      runs: [run],
      working,
    });
  expect(stateOf(republish(true))).toEqual({ state: "publishing" });
  expect(stateOf(republish(false))).toEqual({ state: "stalled" });
});

test("a fact the publish plans do not end on says nothing of publishing", () => {
  expect(
    stateOf(
      records({ release, checks: [{ ...passed, returns: ["app_works"] }] }),
    ),
  ).toMatchObject({ state: "changes" });
});

test("a blocked publish since the last release failed, in the publisher's words", () => {
  expect(
    stateOf(
      records({
        release,
        runs: [
          {
            ...PUBLISHER,
            status: "cancelled",
            startedAt: "2026-11-17T11:00:00.000Z",
            endedAt: "2026-11-17T11:05:00.000Z",
            blocked: { reason: "The server refused the key.", tried: "ssh" },
          },
        ],
      }),
    ),
  ).toEqual({ state: "failed", reason: "The server refused the key." });
});

test("a run that failed before anything was published failed", () => {
  expect(
    stateOf(
      records({
        runs: [
          {
            ...PUBLISHER,
            status: "failed",
            startedAt: "2026-11-17T11:00:00.000Z",
            endedAt: "2026-11-17T11:01:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "failed", reason: undefined });
});

test("a failure older than the latest release no longer counts", () => {
  expect(
    stateOf(
      records({
        release,
        runs: [
          {
            ...PUBLISHER,
            status: "failed",
            startedAt: "2026-11-17T09:00:00.000Z",
            endedAt: "2026-11-17T09:01:00.000Z",
          },
        ],
      }),
    ),
  ).toMatchObject({ state: "changes" });
});

test("only the latest publishing run says whether publishing failed", () => {
  expect(
    stateOf(
      records({
        runs: [
          {
            ...PUBLISHER,
            status: "failed",
            startedAt: "2026-11-17T09:00:00.000Z",
            endedAt: "2026-11-17T09:01:00.000Z",
          },
          {
            ...PUBLISHER,
            status: "cancelled",
            startedAt: "2026-11-17T09:30:00.000Z",
            endedAt: "2026-11-17T09:31:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "unpublished" });
});

test("once the person pressed Publish, the publish is under way before the coordinator takes it up", () => {
  expect(stateOf(records({ pressed: "publish" }))).toEqual({
    state: "publishing",
  });
});

test("between steps of a publish plan, while the coordinator works, the publish is under way", () => {
  for (const state of ["not_started", "waiting", "running", "needs_you"])
    expect(stateOf(records({ plan: group(state), working: true }))).toEqual({
      state: "publishing",
    });
});

test("a publish plan with work ahead and nothing at work on it has stalled", () => {
  expect(stateOf(records({ plan: group("not_started") }))).toEqual({
    state: "stalled",
  });
});

test("after the publish run ended and before the live check records, the publish is still under way", () => {
  expect(
    stateOf(
      records({
        release,
        plan: group("not_started"),
        working: true,
        runs: [
          {
            ...PUBLISHER,
            status: "completed",
            startedAt: "2026-11-17T09:55:00.000Z",
            endedAt: "2026-11-17T10:01:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "publishing" });
  expect(stateOf(records({ release, plan: group("not_started") }))).toEqual({
    state: "stalled",
  });
});

test("a publish plan that ended, was cancelled or was declined is no longer under way", () => {
  for (const state of ["done", "skipped", "cancelled"])
    expect(stateOf(records({ plan: group(state), working: true }))).toEqual({
      state: "unpublished",
    });
});

test("while a publish plan's step failed and anything works on the project, such as a change the app needs, the publish is under way", () => {
  expect(stateOf(records({ plan: group("failed"), working: true }))).toEqual({
    state: "publishing",
  });
});

test("a publish plan left unfinished for another place says nothing over an app published and live, whatever is at work", () => {
  expect(
    stateOf(
      records({
        release,
        checks: [passed],
        plans: [PLAN, "publish-to-host"],
        plan: [
          { plan: PLAN, state: "done" },
          { plan: "publish-to-host", state: "failed" },
        ],
        working: true,
      }),
    ),
  ).toEqual({ state: "published", url: release.url, at: release.at });
});

test("a publish plan left with a failed step and nothing at work is not under way", () => {
  expect(stateOf(records({ plan: group("failed") }))).toEqual({
    state: "unpublished",
  });
});

test("a group of a plan outside the publish group says nothing of publishing", () => {
  expect(
    stateOf(
      records({
        plan: [{ plan: "build-web-app", state: "running" }],
        working: true,
      }),
    ),
  ).toEqual({ state: "unpublished" });
});

const keep = {
  link: "https://dash.example.com/claim?token=secret",
  until: "2026-11-17T11:00:00.000Z",
  place: "Example Host",
};
// Fifty-two minutes before the deadline.
const now = Date.parse(keep.until) - 52 * 60_000 - 30_000;
const pending: PublishKeepNotice = {
  link: keep.link,
  place: keep.place,
  passed: false,
  minutesLeft: 52,
};

test("a published app on a temporary account is to be kept before its deadline", () => {
  expect(
    publishState(records({ release, checks: [passed], keep, now })),
  ).toEqual({
    state: { state: "published", url: release.url, at: release.at },
    keep: pending,
    holding: null,
    takeDown: false,
  });
});

test("the way to keep the app stays whatever state publishing is in while its deadline is ahead", () => {
  const failedRun = {
    ...PUBLISHER,
    status: "failed" as const,
    startedAt: "2026-11-17T10:30:00.000Z",
    endedAt: "2026-11-17T10:31:00.000Z",
  };
  // The account was made but the app answered too slowly for a release to be recorded.
  expect(publishState(records({ keep, now }))?.keep).toEqual(pending);
  expect(
    publishState(records({ release, runs: [failedRun], keep, now }))?.keep,
  ).toEqual(pending);
});

test("the minutes left count down, and once the deadline passes the time to keep it has passed", () => {
  const kept = records({ release, checks: [passed], keep });
  expect(
    publishState({ ...kept, now: Date.parse(keep.until) - 1 })?.keep,
  ).toEqual({ ...pending, minutesLeft: 0 });
  const passedNotice: PublishKeepNotice = {
    link: keep.link,
    place: keep.place,
    passed: true,
  };
  expect(publishState({ ...kept, now: Date.parse(keep.until) })).toEqual({
    state: { state: "published", url: release.url, at: release.at },
    keep: passedNotice,
    holding: null,
    takeDown: false,
  });
  expect(
    publishState(records({ keep, now: Date.parse(keep.until) + 60_000 })),
  ).toEqual({
    state: { state: "unpublished" },
    keep: passedNotice,
    holding: null,
    takeDown: false,
  });
});

test("once the person said they kept it, or no link was recorded, only the state shows", () => {
  for (const cleared of [undefined, null])
    expect(
      publishState(records({ release, checks: [passed], keep: cleared, now })),
    ).toEqual({
      state: { state: "published", url: release.url, at: release.at },
      keep: null,
      holding: null,
      takeDown: false,
    });
});

test("a run that recorded its release and was then blocked published the app, with the way to keep it", () => {
  const recorded = { ...release, at: "2026-11-17T10:02:00.000Z" };
  const slow = {
    ...PUBLISHER,
    status: "cancelled" as const,
    startedAt: "2026-11-17T10:00:00.000Z",
    endedAt: "2026-11-17T10:05:00.000Z",
    blocked: { reason: "The address did not answer yet.", tried: "release" },
  };
  // The hub reads a blocked step as waiting, and the live check has not run.
  expect(
    publishState(
      records({
        release: recorded,
        runs: [slow],
        plan: group("waiting"),
        keep,
        now,
      }),
    ),
  ).toEqual({
    state: { state: "published", url: recorded.url, at: recorded.at },
    keep: pending,
    holding: null,
    takeDown: false,
  });
});

// The server plan's take-down, and a run of it.
const TAKE_DOWN = { plugin: "server", action: "remove" };
const takeDowns = [TAKE_DOWN];
const holding = {
  target: "server",
  place: "Example Cloud",
  since: "2026-11-17T09:00:00.000Z",
  costs: "$6 a month",
};

test("a take-down at work, or asked for and not yet taken up, is taking it down, not publishing", () => {
  expect(
    stateOf(
      records({
        release,
        checks: [passed],
        takeDowns,
        runs: [
          {
            ...TAKE_DOWN,
            status: "running",
            startedAt: "2026-11-17T11:00:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "takingDown" });
  expect(
    stateOf(
      records({ release, checks: [passed], takeDowns, pressed: "takeDown" }),
    ),
  ).toEqual({ state: "takingDown" });
});

test("a take-down that failed reads in its own words while what it removes is still there, and never as a failed publish", () => {
  const blocked = {
    ...TAKE_DOWN,
    status: "cancelled" as const,
    startedAt: "2026-11-17T11:00:00.000Z",
    endedAt: "2026-11-17T11:02:00.000Z",
    blocked: { reason: "Your server did not answer.", tried: "unpublish" },
  };
  const failed = records({
    release,
    checks: [passed],
    takeDowns,
    runs: [blocked],
  });
  expect(publishState(failed)).toEqual({
    state: {
      state: "takeDownFailed",
      reason: "Your server did not answer.",
      released: true,
    },
    keep: null,
    holding: null,
    takeDown: false,
  });
  // Gone since, as when the person said so: the failure no longer counts, nor is it a publish's.
  expect(stateOf({ ...failed, release: null })).toEqual({
    state: "unpublished",
  });
});

// The server's take-down that completed, clearing the release, while the publish plan's live step
// stands not started again.
const removed = {
  ...TAKE_DOWN,
  status: "completed" as const,
  startedAt: "2026-11-17T11:00:00.000Z",
  endedAt: "2026-11-17T11:01:00.000Z",
};
const takenDown = (change: Partial<PublishRecords> = {}) =>
  records({
    release: null,
    checks: [lapsed],
    takeDowns,
    plan: group("not_started"),
    runs: [removed],
    ...change,
  });

test("once a take-down completed, the coordinator still at work is not publishing, nor is the plan it left stalled", () => {
  expect(stateOf(takenDown({ working: true }))).toEqual({
    state: "unpublished",
  });
  expect(stateOf(takenDown())).toEqual({ state: "unpublished" });
});

test("after a take-down, pressing Publish again is a publish under way", () => {
  expect(stateOf(takenDown({ working: true, pressed: "publish" }))).toEqual({
    state: "publishing",
  });
});

test("a publishing run that ended after a take-down is the latest, so the coordinator at work on it is a publish under way", () => {
  // The run ended and the coordinator works on until the live check records.
  expect(
    stateOf(
      takenDown({
        plan: group("not_started"),
        working: true,
        runs: [
          removed,
          {
            ...PUBLISHER,
            status: "completed",
            startedAt: "2026-11-17T11:10:00.000Z",
            endedAt: "2026-11-17T11:12:00.000Z",
          },
        ],
      }),
    ),
  ).toEqual({ state: "publishing" });
});

test("a published app whose plan takes down can be taken down", () => {
  expect(
    publishState(records({ release, checks: [passed], takeDowns })),
  ).toEqual({
    state: { state: "published", url: release.url, at: release.at },
    keep: null,
    holding: null,
    takeDown: true,
  });
  // No plan takes down from there.
  expect(publishState(records({ release, checks: [passed] }))?.takeDown).toBe(
    false,
  );
  // Work under way or a question open offers nothing more.
  for (const busy of [{ asking: true }, { pressed: "publish" as const }])
    expect(
      publishState(records({ release, checks: [passed], takeDowns, ...busy }))
        ?.takeDown,
    ).toBe(false);
});

test("something held with nothing published shows what it costs over the state and can be taken down", () => {
  expect(publishState(records({ holding, takeDowns }))).toEqual({
    state: { state: "unpublished" },
    keep: null,
    holding: {
      place: "Example Cloud",
      since: holding.since,
      costs: "$6 a month",
    },
    takeDown: true,
  });
});

test("a holding's target is what a take-down removes, whatever the release names", () => {
  const elsewhere = { ...release, target: "cloudflare" };
  // The release is another place's, and no plan takes down from it; the holding's plan does.
  expect(
    publishState(records({ release: elsewhere, holding, takeDowns }))?.takeDown,
  ).toBe(true);
  // The holding's place takes nothing down, though the release's would.
  expect(
    publishState(
      records({
        release: elsewhere,
        holding,
        takeDowns: [{ plugin: "cloudflare", action: "remove" }],
      }),
    )?.takeDown,
  ).toBe(false);
});

test("a keep link never hides the way to take down what is held, though it does for a release alone", () => {
  // The keep link is another place's, and the server held here goes on costing money.
  expect(
    publishState(records({ holding, takeDowns, keep, now }))?.takeDown,
  ).toBe(true);
  expect(
    publishState(
      records({ release, checks: [passed], holding, takeDowns, keep, now }),
    )?.takeDown,
  ).toBe(true);
  expect(
    publishState(records({ release, checks: [passed], takeDowns, keep, now }))
      ?.takeDown,
  ).toBe(false);
});

const at = (time: string) => Date.parse(`2026-11-17T${time}.000Z`);
const iso = (time: string) => `2026-11-17T${time}.000Z`;
// The person's go-ahead to take down the release they were shown.
const agreed = { target: "server", release: release.at };

test("from the go-ahead to take it down until the removal ends, the tab never reads published", () => {
  const asked = (change: Partial<PublishRecords>) =>
    records({
      release,
      checks: [passed],
      takeDowns,
      takeDown: agreed,
      acted: at("11:00:00"),
      ...change,
    });
  const removal = {
    ...TAKE_DOWN,
    status: "running" as const,
    startedAt: iso("11:00:06"),
  };
  const steps: Partial<PublishRecords>[] = [
    // Answered; the coordinator is not yet marked at work.
    { now: at("11:00:01") },
    { now: at("11:00:07"), working: true, runs: [removal] },
    // A take-down asked for, with no press in this page, as after a reload.
    { now: at("11:00:30"), acted: null, working: true },
  ];
  for (const step of steps)
    expect(stateOf(asked(step))).toEqual({ state: "takingDown" });
  // The removal ended and cleared the release: nothing is left to take down.
  const ended = {
    ...removal,
    status: "completed" as const,
    endedAt: iso("11:00:20"),
  };
  for (const working of [false, true])
    expect(
      stateOf(
        asked({
          release: null,
          checks: [lapsed],
          plan: group("not_started"),
          runs: [ended],
          ranUntil: at("11:00:20"),
          now: at("11:00:21"),
          working,
        }),
      ),
    ).toEqual({ state: "unpublished" });
});

test("a go-ahead to take down that nothing takes up settles to what the records say once the hand-off has passed", () => {
  expect(
    publishState(
      records({
        release,
        checks: [passed],
        takeDowns,
        takeDown: agreed,
        acted: at("11:00:00"),
        now: at("11:00:00") + HAND_OFF_MS,
      }),
    ),
  ).toEqual({
    state: { state: "published", url: release.url, at: release.at },
    keep: null,
    holding: null,
    takeDown: true,
  });
});

test("a go-ahead for an earlier release, or Keep it, is no take-down under way", () => {
  const later = {
    ...release,
    version: "def456",
    at: "2026-11-17T10:30:00.000Z",
  };
  for (const [shown, takeDown] of [
    [later, agreed],
    [release, null],
  ] as const)
    expect(
      stateOf(
        records({
          release: shown,
          checks: [{ ...passed, createdAt: "2026-11-17T10:31:00.000Z" }],
          plan: group("done"),
          takeDowns,
          takeDown,
          acted: at("11:00:00"),
          now: at("11:00:01"),
          working: true,
        }),
      ),
    ).toMatchObject({ state: "published" });
});

test("a take-down that failed reads as failed while the coordinator tells the person, not as publishing or taking it down", () => {
  const blocked = {
    ...TAKE_DOWN,
    status: "cancelled" as const,
    startedAt: iso("11:00:06"),
    endedAt: iso("11:00:30"),
    blocked: { reason: "Your server did not answer.", tried: "unpublish" },
  };
  expect(
    stateOf(
      records({
        release,
        checks: [passed],
        plan: group("waiting"),
        takeDowns,
        takeDown: agreed,
        runs: [blocked],
        ranUntil: at("11:00:30"),
        now: at("11:00:31"),
      }),
    ),
  ).toEqual({
    state: "takeDownFailed",
    reason: "Your server did not answer.",
    released: true,
  });
});

test("a take-down that failed of what a place holds alone leaves no release to say is gone", () => {
  expect(
    stateOf(
      records({
        release: { ...release, target: "cloudflare" },
        holding,
        takeDowns,
        runs: [
          {
            ...TAKE_DOWN,
            status: "failed",
            startedAt: iso("11:00:06"),
            endedAt: iso("11:00:30"),
          },
        ],
      }),
    ),
  ).toEqual({ state: "takeDownFailed", reason: undefined, released: false });
});

test("from one publishing run to the next, and on to the last check, the publish never drops to the invitation", () => {
  const create = {
    plugin: "server",
    action: "create",
    startedAt: iso("11:00:00"),
  };
  const publish = { ...PUBLISHER, startedAt: iso("11:01:06") };
  const created = {
    ...create,
    status: "completed" as const,
    endedAt: iso("11:01:00"),
  };
  const out = { ...release, at: iso("11:01:30") };
  const steps: Partial<PublishRecords>[] = [
    // The create run ended; the coordinator has not yet taken up its report.
    { runs: [created], ranUntil: at("11:01:00"), now: at("11:01:02") },
    {
      runs: [created],
      ranUntil: at("11:01:00"),
      now: at("11:01:04"),
      working: true,
    },
    // The publish run recorded the release and ended; its live check is not recorded yet.
    {
      release: out,
      runs: [
        created,
        { ...publish, status: "completed", endedAt: iso("11:01:40") },
      ],
      ranUntil: at("11:01:40"),
      now: at("11:01:45"),
    },
  ];
  for (const step of steps)
    expect(stateOf(records({ plan: group("running"), ...step }))).toEqual({
      state: "publishing",
    });
  expect(
    stateOf(
      records({
        plan: group("done"),
        release: out,
        checks: [{ ...passed, createdAt: iso("11:01:50") }],
        runs: [
          created,
          { ...publish, status: "completed", endedAt: iso("11:01:40") },
        ],
        ranUntil: at("11:01:40"),
        now: at("11:01:52"),
      }),
    ),
  ).toMatchObject({ state: "published" });
});

test("a step that failed or was blocked is still a publish under way until the hand-off has passed with nothing at work", () => {
  const blocked = {
    ...PUBLISHER,
    status: "cancelled" as const,
    startedAt: iso("11:00:00"),
    endedAt: iso("11:00:10"),
    blocked: { reason: "The server refused the key.", tried: "ssh" },
  };
  const after = (state: string, change: Partial<PublishRecords>) =>
    stateOf(
      records({ plan: group(state), ranUntil: at("11:00:10"), ...change }),
    );
  // The hub reads a blocked step as waiting; a failed check fails the group.
  expect(after("waiting", { runs: [blocked], now: at("11:00:12") })).toEqual({
    state: "publishing",
  });
  expect(after("failed", { now: at("11:00:12") })).toEqual({
    state: "publishing",
  });
  const settled = at("11:00:10") + HAND_OFF_MS;
  expect(
    after("waiting", { runs: [blocked], now: settled, working: true }),
  ).toEqual({ state: "publishing" });
  expect(after("waiting", { runs: [blocked], now: settled })).toEqual({
    state: "failed",
    reason: "The server refused the key.",
  });
  expect(after("failed", { now: settled })).toEqual({ state: "unpublished" });
});

test("a publishing question answered keeps the publish under way until the coordinator takes it up", () => {
  expect(
    stateOf(
      records({
        plan: group("needs_you"),
        acted: at("11:00:00"),
        now: at("11:00:04"),
      }),
    ),
  ).toEqual({ state: "publishing" });
});

test("the tab is told when the hand-off ends and when the keep link's minutes tick, whichever is first", () => {
  expect(changesAt(records({ now: at("11:00:00") }))).toBeNull();
  expect(
    changesAt(records({ ranUntil: at("11:00:00"), now: at("11:00:05") })),
  ).toBe(at("11:00:00") + HAND_OFF_MS);
  expect(
    changesAt(
      records({
        acted: at("11:00:00"),
        ranUntil: at("10:59:00"),
        now: at("11:00:00") + HAND_OFF_MS,
      }),
    ),
  ).toBeNull();
  // Fifty-two and a half minutes before the deadline, the minutes left next change in 30 s.
  expect(changesAt(records({ keep, now }))).toBe(now + 30_001);
  expect(
    changesAt(records({ keep, now, ranUntil: now - HAND_OFF_MS + 1_000 })),
  ).toBe(now + 1_000);
});
