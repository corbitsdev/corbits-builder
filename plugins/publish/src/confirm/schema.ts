import { type } from "arktype";

// The handle of the ready-made publish plan the app is about to be published by.
export const Input = type({ "+": "reject", plan: "string > 0" });

// The person's go-ahead, with the plan it is for.
export const Output = type({ "+": "reject", go: "true", plan: "string > 0" });
