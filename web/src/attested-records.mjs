const REQUESTS = "https://api.imd.fun/oracle/requests";

// One queue per Wallet view. A record (including a duplicate id on two facts)
// gets one bounded batch; only an explicit Retry starts another failed batch.
export function attestedRecords({
  fetcher = fetch,
  retryMs = 2000,
  timeoutMs = 12000,
} = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const records = new Map();
  let tail = Promise.resolve();
  const stopped = () => {
    if (signal.aborted) throw Error("Record read stopped.");
  };
  const pause = () =>
    new Promise((resolve, reject) => {
      stopped();
      const done = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(done, retryMs);
      const abort = () => {
        clearTimeout(timer);
        reject(Error("Record read stopped."));
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  function attempt(id) {
    const next = tail.then(async () => {
      stopped();
      const response = await fetcher(`${REQUESTS}/${encodeURIComponent(id)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) throw Error("Record unavailable.");
      const record = await response.json();
      if (record?.id !== id) throw Error("Record id mismatch.");
      if (record.attestedAt && !Number.isFinite(Date.parse(record.attestedAt)))
        throw Error("Invalid attested time.");
      stopped();
      return record;
    });
    tail = next.catch(() => {});
    return next;
  }
  return {
    read(id, { retry = false } = {}) {
      const previous = records.get(id);
      if (previous && (!retry || !previous.failed)) return previous.promise;
      const entry = { failed: false, promise: null };
      entry.promise = (async () => {
        for (let i = 0; ; i++) {
          stopped();
          try {
            return await attempt(id);
          } catch (error) {
            stopped();
            if (i === 3) throw error;
            await pause();
          }
        }
      })().catch((error) => {
        entry.failed = true;
        throw error;
      });
      records.set(id, entry);
      return entry.promise;
    },
    stop: () => controller.abort(),
  };
}
