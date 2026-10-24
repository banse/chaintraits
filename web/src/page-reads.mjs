// Expensive launch-to-head reads run once in a page view. Keep both success
// and failure; only the automatic read recovery (readRetry) clears failed entries.
export function pageReads() {
  const entries = new Map();
  const controller = new AbortController();
  return {
    signal: controller.signal,
    once(key, load) {
      if (!entries.has(key)) {
        const entry = { failed: false, promise: null };
        entry.promise = Promise.resolve()
          .then(load)
          .catch((error) => {
            entry.failed = true;
            throw error;
          });
        entries.set(key, entry);
      }
      return entries.get(key).promise;
    },
    retryFailed() {
      for (const [key, entry] of entries) if (entry.failed) entries.delete(key);
    },
    stop: () => controller.abort(),
  };
}
