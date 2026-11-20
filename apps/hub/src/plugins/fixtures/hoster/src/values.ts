import { type } from "arktype";
import { defineValue } from "@corbits-builder/plugin";

export const CHOICE = defineValue(
  "hoster.choice",
  type("unknown"),
  'The machine the person agreed to rent, as { "size": its size, "region": where it runs }.',
);

export const REGION = defineValue(
  "hoster.region",
  type("string"),
  "Where the rented machine runs.",
);

export default [CHOICE, REGION];
