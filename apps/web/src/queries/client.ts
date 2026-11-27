import {
  QueryClient,
  type DehydratedState,
  type DehydrateOptions,
} from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type AsyncStorage,
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

/**
 * What the browser keeps between visits. A query that still has data is kept after a failed
 * refetch. One marked `meta: { persist: false }` only matters while this page waits on it. One
 * whose `meta.persist` is a function keeps only what that function returns of its data.
 */
export const savedReads: DehydrateOptions = {
  shouldDehydrateQuery: (query) =>
    query.state.data !== undefined && query.meta?.["persist"] !== false,
};

// The saved reads as the browser keeps them, each cut to what its `meta.persist` keeps.
const keptState = (state: DehydratedState): DehydratedState => ({
  ...state,
  queries: state.queries.map((query) => {
    const keep = query.meta?.["persist"];
    return typeof keep === "function"
      ? { ...query, state: { ...query.state, data: keep(query.state.data) } }
      : query;
  }),
});

/** Saves the cache in storage as the browser keeps it. */
export const cachePersister = (storage: AsyncStorage) =>
  createAsyncStoragePersister({
    key: "builder-query-cache",
    storage,
    serialize: (client) =>
      JSON.stringify({ ...client, clientState: keptState(client.clientState) }),
  });

const persistOptions: PersistQueryClientOptions = {
  queryClient,
  persister: cachePersister({ getItem: get, setItem: set, removeItem: del }),
  maxAge: CACHE_LIFETIME_MS,
  // Saved data is read back without checking its shape, so a change to what a cached read
  // holds needs a new value here, or pages render the old shape and break.
  buster:
    "room-question-status-screens-hub-preferences-listed-ready-plans-finished",
  dehydrateOptions: savedReads,
};

/**
 * Puts the saved cache on the client and saves it from then on. The cache only
 * spares the first reads, so a restore that fails for any reason leaves the
 * client empty and the page loads from the network.
 */
async function restoreQueryCache(): Promise<void> {
  try {
    await persistQueryClientRestore(persistOptions);
  } catch (cause) {
    console.warn("The saved query cache could not be restored.", cause);
  }
  persistQueryClientSubscribe(persistOptions);
}

/** Resolves after the saved cache is on the client, before the first paint. */
export const queryCacheReady: Promise<void> = restoreQueryCache();
