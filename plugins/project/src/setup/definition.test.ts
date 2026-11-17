import { expect, test } from "bun:test";
import { validateInput } from "@corbits-builder/plugin";
import screen from "./definition.ts";

test("a step whose link is not https is refused, naming the field", () => {
  const result = validateInput(
    "project setup",
    screen,
    {
      title: "Connect the bot to your workspace",
      steps: [
        {
          instruction: "Create an app for the bot.",
          link: "http://api.example.com/apps",
          setting: "BOT_TOKEN",
        },
      ],
    },
    undefined,
    {},
  );
  if (result.ok) throw new Error("a plain-http link was taken");
  expect(result.refusal.wrong[0]?.field).toBe("steps");
  expect(result.text).toContain("0.link must be an https address");
});
