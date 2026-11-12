import { type } from "arktype";

// What a colour input produces, and how Builder's look tweaks store the primary and background.
export const Color = type(/^#[0-9a-fA-F]{6}$/);

export const Input = type({
  "+": "reject",
  // Checked in prepare, so a wrong colour is refused with the format and an example.
  "proposed?": {
    "+": "reject",
    "primary?": "string > 0",
    "background?": "string > 0",
  },
});

export const Output = type({
  "+": "reject",
  primary: Color,
  background: Color,
});
