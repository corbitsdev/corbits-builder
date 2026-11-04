import { expect, test } from "bun:test";
import { type } from "arktype";
import { readJson } from "./json.ts";

const Shape = type({ count: "number" });

test("JSON of the wrong shape, JSON null and text that is not JSON all read as null", () => {
  expect(readJson('{"count":2}', Shape)).toEqual({ count: 2 });
  expect(readJson('{"count":"2"}', Shape)).toBeNull();
  expect(readJson("null", Shape)).toBeNull();
  expect(readJson("{not json", Shape)).toBeNull();
});
