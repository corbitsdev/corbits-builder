import { expect, test } from "bun:test";
import {
  MODEL_PROVIDERS,
  frozenModelChoice,
  invalidModelChoice,
  resolveModelChoice,
} from "./models.ts";

test("a project runs on the only connected provider's profile, a chosen one, or none", () => {
  expect(
    resolveModelChoice(MODEL_PROVIDERS, null, ["anthropic"]),
  ).toMatchObject({
    choice: { profile: "anthropic_default" },
  });
  expect(
    resolveModelChoice(MODEL_PROVIDERS, null, ["anthropic", "openai"]),
  ).toEqual({
    refused: "model_profile_required",
  });
  expect(resolveModelChoice(MODEL_PROVIDERS, null, [])).toEqual({
    refused: "model_provider_missing",
  });
  expect(
    resolveModelChoice(MODEL_PROVIDERS, { profile: "openai_default" }, [
      "anthropic",
      "openai",
    ]),
  ).toMatchObject({
    choice: { profile: "openai_default" },
  });
  // A stored choice this server no longer offers is no choice.
  expect(
    resolveModelChoice(MODEL_PROVIDERS, { profile: "gone_default" }, [
      "anthropic",
      "openai",
    ]),
  ).toEqual({
    refused: "model_profile_required",
  });
  expect(
    resolveModelChoice(MODEL_PROVIDERS, { profile: "openai_default" }, [
      "anthropic",
    ]),
  ).toMatchObject({
    choice: { profile: "anthropic_default" },
  });
  expect(
    resolveModelChoice(MODEL_PROVIDERS, { profile: "xai_default" }, [
      "anthropic",
      "openai",
    ]),
  ).toEqual({
    refused: "model_profile_required",
  });
  expect(
    frozenModelChoice(MODEL_PROVIDERS, { profile: "openai_default" }, [
      "anthropic",
    ]),
  ).toBeNull();
});

test("invalidModelChoice refuses activating a profile whose provider is not connected", () => {
  const custom = {
    id: "custom_mix",
    label: "Mix",
    tiers: {
      low: { provider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
      medium: {
        provider: "openai",
        model: "gpt-6.1-terra",
        effort: "medium",
      },
      high: {
        provider: "anthropic",
        model: "claude-opus-5-5",
        effort: "medium",
      },
      max: { provider: "anthropic", model: "claude-opus-5-5", effort: "max" },
    },
  } as const;

  expect(
    invalidModelChoice(MODEL_PROVIDERS, { profile: "anthropic_default" }, [
      "anthropic",
    ]),
  ).toBeUndefined();
  expect(
    invalidModelChoice(MODEL_PROVIDERS, { profile: "openai_default" }, [
      "anthropic",
    ]),
  ).toBe("openai_default:low:unconnected:openai");
  expect(
    invalidModelChoice(
      MODEL_PROVIDERS,
      { profile: "custom_mix", custom: [custom] },
      ["anthropic"],
    ),
  ).toBe("custom_mix:medium:unconnected:openai");
  expect(
    invalidModelChoice(
      MODEL_PROVIDERS,
      { profile: "anthropic_default", custom: [custom] },
      ["anthropic"],
    ),
  ).toBeUndefined();
});
