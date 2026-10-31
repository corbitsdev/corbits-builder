import { parseDiscoveredModels } from "@corbits-builder/schemas/catalog";
import { SettingsProviders } from "@corbits-builder/schemas/settings";
import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

/**
 * Thin composition pieces for deploy-time inference catalog setup. These wrap
 * the native catalog routes verbatim; the deploy composition in the UI decides
 * the order and reuses existing offerings before creating anything.
 */
export type CatalogModelView = Readonly<{ id: string; canonicalName: string }>;
export type CatalogOfferingView = Readonly<{
  id: string;
  modelId: string;
  providerId: string;
}>;

function idOf(raw: unknown): string {
  const row = raw as Record<string, unknown> | null;
  if (typeof row?.["id"] !== "string" || row["id"] === "")
    throw new Error("invalid_native_catalog_response");
  return row["id"];
}

export function buildCatalogMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "models"
  | "settingsProviders"
  | "createCatalogModel"
  | "createCatalogOffering"
> {
  const { catalogResponse, request } = deps;
  return {
    async models(tenantId, signal) {
      const raw = await catalogResponse(
        `${tenantPath(tenantId)}/models`,
        signal,
      );
      return parseDiscoveredModels(raw);
    },
    async settingsProviders(tenantId, signal) {
      const raw = await catalogResponse(
        `${tenantPath(tenantId)}/settings/providers`,
        signal,
      );
      if (!SettingsProviders.allows(raw))
        throw new Error("invalid_settings_providers_response");
      return raw;
    },
    async createCatalogModel(tenantId, input, signal) {
      const raw = await request(
        `${tenantPath(tenantId)}/catalog/models`,
        signal,
        {
          canonicalName: input.canonicalName,
        },
      );
      return { id: idOf(raw), canonicalName: input.canonicalName };
    },
    async createCatalogOffering(tenantId, input, signal) {
      const raw = await request(
        `${tenantPath(tenantId)}/catalog/offerings`,
        signal,
        {
          modelId: input.modelId,
          providerId: input.providerId,
        },
      );
      return {
        id: idOf(raw),
        modelId: input.modelId,
        providerId: input.providerId,
      };
    },
  };
}
