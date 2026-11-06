import { expect, test } from "bun:test";
import { ApiFailure } from "./api/types.ts";
import { hubReadState } from "./first-run.ts";

const dropped = new TypeError("Failed to fetch");
const refused = (httpStatus: number) =>
  new ApiFailure(
    {
      code: "refused",
      message: "refused",
      correlationId: "c",
      retryable: false,
    },
    httpStatus,
  );

test("a refresh failing after a good read keeps the shell under the offline banner", () => {
  const state = hubReadState([
    { data: { providers: [] }, error: dropped },
    { data: { projects: [] }, error: refused(502) },
  ]);
  expect(state).toEqual({
    signedOut: false,
    offline: true,
    blocksShell: false,
  });
});

test("a first read failing shows the boot screen", () => {
  const state = hubReadState([
    { data: { providers: [] }, error: null },
    { data: undefined, error: dropped },
  ]);
  expect(state).toEqual({ signedOut: false, offline: true, blocksShell: true });
});

test("a 401 or 403 on a refresh signs out rather than reading as offline", () => {
  for (const status of [401, 403]) {
    const state = hubReadState([
      { data: { providers: [] }, error: dropped },
      { data: { projects: [] }, error: refused(status) },
    ]);
    expect(state).toEqual({
      signedOut: true,
      offline: false,
      blocksShell: false,
    });
  }
});
