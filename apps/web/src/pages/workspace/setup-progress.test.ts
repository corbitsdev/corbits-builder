import { expect, test } from "bun:test";
import { ago, setupProgressLine } from "./setup-progress.ts";

const progress = {
  turns: 3,
  recent: ["write_file client/src/pages/routines.tsx"],
  filesWritten: 12,
  files: ["client/src/api.ts", "client/src/pages/routines.tsx"],
  lastActivityAt: "2026-11-02T02:23:22.000Z",
};

test("the first build's line names the count, the last file in plain words, and the quiet time", () => {
  expect(setupProgressLine(progress, 20_000)).toBe(
    "12 files written · last: routines · 20 s ago",
  );
  expect(setupProgressLine({ ...progress, filesWritten: 1 }, 2_000)).toBe(
    "1 file written · last: routines · just now",
  );
});

test("before the first write the line still says how long it has been", () => {
  expect(
    setupProgressLine({ ...progress, filesWritten: 0, files: [] }, 45_000),
  ).toBe("No files written yet · last activity 45 s ago");
  expect(setupProgressLine(undefined, 45_000)).toBeUndefined();
});

test("quiet time reads in seconds under two minutes, then in minutes", () => {
  expect(ago(1_000)).toBe("just now");
  expect(ago(59_000)).toBe("59 s ago");
  expect(ago(119_000)).toBe("119 s ago");
  expect(ago(200_000)).toBe("3 min ago");
});
