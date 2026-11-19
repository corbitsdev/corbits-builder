import { type } from "arktype";

// The screen lists the installed publish plans itself, so it takes no input.
export const Input = type({ "+": "reject" });

// The handle of the ready-made publish plan the person chose.
export const Output = type({ "+": "reject", plan: "string > 0" });
