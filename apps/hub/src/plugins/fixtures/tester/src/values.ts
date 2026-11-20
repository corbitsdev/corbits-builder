import { type } from "arktype";
import { defineValue } from "@corbits-builder/plugin";

export const NOTES = defineValue(
  "tester.notes",
  type("string"),
  "What the person asked the tester to look into last.",
);

export default [NOTES];
