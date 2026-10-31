import { type } from "arktype";

// Public projection of the native model-discovery response. This is a wire
// contract, never a second catalog, price seed, capability or connection registry.
const id = type("string > 0");
const price = type("string | null");
const CatalogPrice = type({
  "+": "reject",
  id,
  tenantId: id,
  offeringId: id,
  currency: id,
  "inputTokenPrice?": price,
  "outputTokenPrice?": price,
  "cacheReadTokenPrice?": price,
  "cacheWriteTokenPrice?": price,
  "thinkingTokenPrice?": price,
  "perRequestFee?": price,
  "perImageFee?": price,
  "perAudioFee?": price,
  effectiveFrom: id,
  createdAt: id,
});
export const DiscoveredModels = type({
  "+": "reject",
  id,
  canonicalName: id,
  "displayName?": "string | null",
  "description?": "string | null",
  offerings: type({
    "+": "reject",
    offeringId: id,
    providerId: id,
    providerName: id,
    plugin: id,
    priority: "number",
    deploymentTags: "string[]",
    capabilities: "string[]",
    pricing: CatalogPrice.array(),
  }).array(),
}).array();
export type DiscoveredModels = typeof DiscoveredModels.infer;

// No parser diagnostics containing server-supplied values escape this boundary.
export function parseDiscoveredModels(raw: unknown): DiscoveredModels {
  const models = DiscoveredModels(raw);
  if (
    models instanceof type.errors ||
    models.some((model) =>
      model.offerings.some((offering) =>
        offering.pricing.some((row) => row.offeringId !== offering.offeringId),
      ),
    )
  )
    throw new Error("invalid_native_model_discovery_response");
  return models;
}
