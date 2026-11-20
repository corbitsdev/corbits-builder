import { type } from "arktype";
import { FileValue, LinkValue, defineValue } from "@corbits-builder/plugin";

export const GUIDELINES = defineValue(
  "brand.guidelines",
  type("string").or(LinkValue).or(FileValue),
  "The brand's guidelines: voice, tone, and what to do and avoid, in the person's words, at a link they gave, or in a file they attached.",
);

export default [GUIDELINES];
