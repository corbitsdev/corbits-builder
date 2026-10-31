import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistQueryClientOptions,
} from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

// A persisted query that is garbage collected drops out of the next save, so
// the cache and the persisted copy share one lifetime.
const CACHE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The one query client, module-level so code outside the component tree can
 * invalidate what it knows has changed. A clock is a backstop, never the
 * mechanism: nothing refetches in a hidden tab, and a stream event is what
 * marks a query stale.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: CACHE_LIFETIME_MS,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});

const persistOptions: PersistQueryClientOptions = {
  queryClient,
  persister: createAsyncStoragePersister({
    key: "builder-query-cache",
    storage: { getItem: get, setItem: set, removeItem: del },
  }),
  maxAge: CACHE_LIFETIME_MS,
  // A query that still has data is kept after a failed refetch.
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.data !== undefined,
  },
};

/**
 * Resolves after the saved cache is on the client, before the first paint. An
 * unreadable cache leaves the client empty and the page loads from the network.
 */
export const queryCacheReady: Promise<void> = persistQueryClientRestore(
  persistOptions,
)
  .catch(() => undefined)
  .then(() => {
    persistQueryClientSubscribe(persistOptions);
  });
