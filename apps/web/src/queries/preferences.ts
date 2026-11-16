import { queryOptions, useQuery } from "@tanstack/react-query";
import { productClient } from "../api/transport.ts";
import { workspaceTenantId } from "../api/auth.ts";
import { keys } from "./keys.ts";

export const preferencesQuery = queryOptions({
  queryKey: keys.preferences,
  meta: { persist: false },
  queryFn: async () => {
    const tenantId = await workspaceTenantId();
    const [registry, record] = await Promise.all([
      productClient().preferenceRegistry(tenantId),
      productClient().personalSettings(tenantId),
    ]);
    return {
      registry: registry.preferences,
      saved: record.fields.preferences ?? { value: null, version: 0 },
    };
  },
});

export function usePreference(id: string) {
  const { data } = useQuery(preferencesQuery);
  return (
    data?.saved.value?.[id] ??
    data?.registry.find((entry) => entry.id === id)?.default
  );
}
