import { PublishTakeDown } from "@corbits-builder/plugin/publish";
import { type } from "arktype";

// The handle of the ready-made publish plan whose target the app is taken down from.
export const Input = type({ "+": "reject", plan: "string > 0" });

// The person's go-ahead for what they were shown, or null when they keep the app.
export const Output = type({
  "+": "reject",
  agreed: PublishTakeDown.or("null"),
});
