// Cache successful immutable reads per deployment/provider, and short-lived
// append-only catalogs. Failed work is evicted so recovery can retry it.
export function cachedReads({ now = () => Date.now() } = {}) {
  const entries = new Map();
  return {
    read(key, load, { version = "", ttlMs = Infinity } = {}) {
      const old = entries.get(key);
      if (old && old.version === version && old.expires > now())
        return old.promise;
      const entry = { version, expires: Infinity, promise: null };
      entry.promise = Promise.resolve()
        .then(load)
        .then((value) => {
          entry.expires = now() + ttlMs;
          return value;
        })
        .catch((error) => {
          if (entries.get(key) === entry) entries.delete(key);
          throw error;
        });
      entries.set(key, entry);
      return entry.promise;
    },
  };
}

// One refresh per app: hidden tabs send no refreshes, a deadline stops the RPC
// scope, and a stalled request cannot accumulate behind another interval tick.
/** @param {{timeoutMs?: number, visible?: () => boolean}} options */
export function boundedRefresh({
  timeoutMs = 25000,
  visible = () => true,
} = {}) {
  let active;
  return {
    run(load) {
      if (!visible()) return Promise.resolve();
      if (active) return active.promise;
      const controller = new AbortController();
      const entry = { controller, promise: null };
      const stopped = new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
      });
      const timer = setTimeout(
        () => controller.abort(Error("Chain refresh timed out.")),
        timeoutMs,
      );
      entry.promise = Promise.race([
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw controller.signal.reason;
          return load(controller.signal);
        }),
        stopped,
      ]).finally(() => {
        clearTimeout(timer);
        if (active === entry) active = undefined;
      });
      active = entry;
      return entry.promise;
    },
    stop() {
      active?.controller.abort(Error("Chain refresh cancelled."));
      active = undefined;
    },
  };
}
