/**
 * One `EventSource` per URL per tab, shared by every subscriber and released
 * while the tab is hidden.
 *
 * Every stream this interface opens goes to the same origin over HTTP/1.1,
 * where Chrome allows six connections per host in total. One stream per
 * subscriber across two tabs exceeds that, and every ordinary fetch, in every
 * tab, then queues behind the streams for good.
 *
 * Facades on the same URL share one real source, opened on the first and
 * closed after the last. A hidden tab closes its real sources and reopens
 * them when it is looked at again, announcing `open` to every facade so a
 * subscriber can treat it as a reconnect; the tab a person is looking at is
 * then the only one holding connections.
 */
type Listener = (event: { data: string }) => void;

export type SharedEventSourceLike = {
  addEventListener(type: string, listener: Listener): void;
  close(): void;
};

type SharedEventSourceDeps = {
  createRaw: (url: string, withCredentials: boolean) => SharedEventSourceLike;
  /** Whether the tab is visible right now. */
  visible: () => boolean;
};

type Facade = { listeners: Map<string, Set<Listener>>; closed: boolean };
type Entry = {
  url: string;
  withCredentials: boolean;
  raw: SharedEventSourceLike | null;
  facades: Set<Facade>;
  /** Event types wired on `raw` so far; a new type is added to the live source as it appears. */
  wired: Set<string>;
};

const defaultDeps: SharedEventSourceDeps = {
  createRaw: (url, withCredentials) =>
    new EventSource(url, { withCredentials }),
  visible: () =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
};

function createSharedEventSources(deps: SharedEventSourceDeps = defaultDeps) {
  const entries = new Map<string, Entry>();

  const dispatch = (entry: Entry, type: string, event: { data: string }) => {
    for (const facade of entry.facades) {
      if (facade.closed) continue;
      for (const listener of facade.listeners.get(type) ?? []) listener(event);
    }
  };

  const wire = (entry: Entry, type: string) => {
    if (!entry.raw || entry.wired.has(type)) return;
    entry.wired.add(type);
    entry.raw.addEventListener(type, (event) => dispatch(entry, type, event));
  };

  const open = (entry: Entry) => {
    if (entry.raw || entry.facades.size === 0 || !deps.visible()) return;
    entry.raw = deps.createRaw(entry.url, entry.withCredentials);
    entry.wired = new Set();
    const types = new Set<string>(["open", "error", "message"]);
    for (const facade of entry.facades)
      for (const type of facade.listeners.keys()) types.add(type);
    for (const type of types) wire(entry, type);
  };

  const release = (entry: Entry) => {
    entry.raw?.close();
    entry.raw = null;
    entry.wired = new Set();
  };

  return {
    /** A subscriber's own handle on the shared stream for `url`. */
    open(url: string, withCredentials: boolean): SharedEventSourceLike {
      let entry = entries.get(url);
      if (!entry) {
        entry = {
          url,
          withCredentials,
          raw: null,
          facades: new Set(),
          wired: new Set(),
        };
        entries.set(url, entry);
      }
      const facade: Facade = { listeners: new Map(), closed: false };
      entry.facades.add(facade);
      const owner = entry;
      open(owner);
      return {
        addEventListener(type, listener) {
          if (facade.closed) return;
          let set = facade.listeners.get(type);
          if (!set) {
            set = new Set();
            facade.listeners.set(type, set);
          }
          set.add(listener);
          wire(owner, type);
        },
        close() {
          if (facade.closed) return;
          facade.closed = true;
          owner.facades.delete(facade);
          if (owner.facades.size === 0) {
            release(owner);
            entries.delete(owner.url);
          }
        },
      };
    },
    /** The tab was hidden: let go of every connection, keeping the subscribers. */
    hidden() {
      for (const entry of entries.values()) release(entry);
    },
    /** The tab is looked at again: reopen for everyone still subscribed and say so. */
    visible() {
      for (const entry of entries.values()) {
        if (entry.raw || entry.facades.size === 0) continue;
        open(entry);
        if (entry.raw) dispatch(entry, "open", { data: "" });
      }
    },
  };
}

const shared = createSharedEventSources();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") shared.hidden();
    else shared.visible();
  });
}

/** The tab's shared stream for `url` -- what every opener in this interface uses. */
export function openSharedEventSource(
  url: string,
  withCredentials: boolean,
): SharedEventSourceLike {
  return shared.open(url, withCredentials);
}
