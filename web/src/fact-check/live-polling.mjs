export const HISTORY_BLOCKS = 7200n;
export function boundedRange(head, launch, before) {
  const toBlock =
    before === undefined ? head : before - 1n < head ? before - 1n : head;
  if (toBlock < launch) return null;
  return {
    fromBlock:
      toBlock - HISTORY_BLOCKS + 1n > launch
        ? toBlock - HISTORY_BLOCKS + 1n
        : launch,
    toBlock,
  };
}

/** One selected request, one in-flight read. Visibility loss invalidates it. */
export function visiblePolling({
  document,
  load,
  interval = 5000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let stopped = false,
    timer,
    controller,
    generation = 0;
  function cancel() {
    generation++;
    controller?.abort();
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }
  async function run() {
    if (stopped || document.hidden) return;
    const version = ++generation;
    controller = new AbortController();
    const current = () =>
      !stopped && !document.hidden && version === generation;
    try {
      await load(controller.signal, current);
    } finally {
      if (current()) timer = setTimer(run, interval);
    }
  }
  function visibility() {
    cancel();
    if (!document.hidden) void run();
  }
  document.addEventListener("visibilitychange", visibility);
  void run();
  return () => {
    stopped = true;
    cancel();
    document.removeEventListener("visibilitychange", visibility);
  };
}
