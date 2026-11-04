/**
 * Throttled room reloads.
 *
 * Stream frames arrive in bursts. The first request reads at once; later
 * requests inside the quiet window fold into one trailing read. A newer read
 * still supersedes a slow one in `loadProjectRoom`, so nothing waits on it.
 */
export type RoomReloadDeps = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

const defaultDeps: RoomReloadDeps = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
};

export function createRoomReloader(
  load: () => Promise<unknown>,
  quietMs = 250,
  deps: RoomReloadDeps = defaultDeps,
): { request: () => void; dispose: () => void } {
  let last = Number.NEGATIVE_INFINITY;
  let timer: number | null = null;
  let disposed = false;

  const read = async () => {
    try {
      await load();
    } catch (cause) {
      // `loadProjectRoom` keeps the last room on a failed read, and with none it fails the room
      // read itself, which shows the fault. A background read has nothing more to show.
      console.warn("The room could not be reloaded.", cause);
    }
  };
  const fire = () => {
    last = deps.now();
    void read();
  };

  return {
    request: () => {
      if (disposed || timer !== null) return;
      const wait = last + quietMs - deps.now();
      if (wait <= 0) {
        fire();
        return;
      }
      timer = deps.setTimeout(() => {
        timer = null;
        if (!disposed) fire();
      }, wait);
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) deps.clearTimeout(timer);
    },
  };
}
