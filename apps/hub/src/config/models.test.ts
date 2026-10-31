import { expect, test } from "bun:test";
import { resolveModelChoice } from "./models.ts";

test("a project runs on the only connected provider's profile, a chosen one, or none", () => {
  expect(resolveModelChoice(null, ["anthropic"])).toMatchObject({
    choice: { profile: "anthropic_default" },
  });
  expect(resolveModelChoice(null, ["anthropic", "openai"])).toEqual({
    refused: "model_profile_required",
  });
  expect(resolveModelChoice(null, [])).toEqual({
    refused: "model_provider_missing",
  });
  expect(
    resolveModelChoice({ profile: "openai_default" }, ["anthropic", "openai"]),
  ).toMatchObject({
    choice: { profile: "openai_default" },
  });
  // A stored choice this server no longer offers is no choice.
  expect(
    resolveModelChoice({ profile: "gone_default" }, ["anthropic", "openai"]),
  ).toEqual({
    refused: "model_profile_required",
  });
});
