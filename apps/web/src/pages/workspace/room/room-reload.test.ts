import { expect, test } from "bun:test";
import { createRoomReloader } from "./room-reload.ts";

test("the first request reads at once and a burst after it folds into one trailing read", () => {
  let clock = 0;
  const timers: { at: number; run: () => void }[] = [];
  let reads = 0;
  const reloader = createRoomReloader(
    async () => {
      reads += 1;
    },
    250,
    {
      now: () => clock,
      setTimeout: (run, ms) => timers.push({ at: clock + ms, run }),
      clearTimeout: () => {},
    },
  );
  reloader.request();
  expect(reads).toBe(1);
  clock = 100;
  reloader.request();
  reloader.request();
  expect(reads).toBe(1);
  expect(timers.map((timer) => timer.at)).toEqual([250]);
  clock = 250;
  timers.shift()?.run();
  expect(reads).toBe(2);
  clock = 600;
  reloader.request();
  expect(reads).toBe(3);
});
