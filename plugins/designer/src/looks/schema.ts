import { type } from "arktype";

// How many looks the person may choose to compare: the first three of the design concepts preference.
export const Looks = type("'one' | 'two' | 'three'");

// The person's design concepts setting now, which the screen offers first; a plan holds the step
// without it, since only the project's settings say it.
export const Input = type({
  "+": "reject",
  "current?": "'one' | 'two' | 'three' | 'four' | 'five'",
});

// How many looks the person wants to compare.
export const Output = type({ "+": "reject", looks: Looks });
