import { describe, expect, test } from "bun:test";
import { Output } from "@plugins/designer/src/pick-colours/schema.ts";
import { draftOf } from "./screen-question.tsx";

describe("a screen's stored draft", () => {
  const read = draftOf(Output);

  test("keeps a draft with fields still to choose, and a whole answer", () => {
    expect(read({ primary: "#1d4ed8" })).toEqual({ primary: "#1d4ed8" });
    expect(read({})).toEqual({});
    expect(read({ primary: "#1d4ed8", background: "#ffffff" })).toEqual({
      primary: "#1d4ed8",
      background: "#ffffff",
    });
  });

  test("keeps unfinished text rather than silently restoring the previous colour", () => {
    expect(read({ primary: "#12" })).toEqual({ primary: "#12" });
    expect(read({ primary: "" })).toEqual({ primary: "" });
  });

  test("drops drafts with the wrong shape", () => {
    expect(read({ primary: "#1d4ed8", shade: "dark" })).toBeUndefined();
    expect(read(["#1d4ed8"])).toBeUndefined();
    expect(read("#1d4ed8")).toBeUndefined();
  });
});
