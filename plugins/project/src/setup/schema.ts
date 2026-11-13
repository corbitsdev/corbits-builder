import { type } from "arktype";

const Line = type("string > 0")
  .and(/^[^\r\n]+$/)
  .describe("one line of text");

// Only https: the person opens it from the card, and a plain-http page could be read or changed on
// the way to them.
const Link = type("string.url")
  .and(/^https:\/\//i)
  .describe("an https address");

// The name of an environment setting, never its value.
const Setting = type(/^[A-Z][A-Z0-9_]*$/).describe(
  "an environment setting's name in capitals, such as BOT_TOKEN",
);

const Step = type({
  "+": "reject",
  instruction: Line,
  "detail?": "string > 0",
  "link?": Link,
  "needsDeployment?": "boolean",
  "setting?": Setting,
});
export type Step = typeof Step.infer;

export const Input = type({
  "+": "reject",
  title: Line,
  steps: Step.array().atLeastLength(1),
});

// Steps by their number in the order given, from 1.
const StepNumbers = type("number.integer >= 1").array();

// The steps the person did, and those they left for later.
export const Output = type({
  "+": "reject",
  done: StepNumbers,
  left: StepNumbers,
});
