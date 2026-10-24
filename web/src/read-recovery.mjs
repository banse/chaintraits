// Failed reads recover by themselves: a read that exhausted the RPC pool is
// noted here, and the app runs every failed read again after a short,
// growing pause. There is no visitor control for it.
const listeners = new Set();
export const RECOVERY_MS = [4000, 8000, 16000, 32000];
export function noteReadFailure() {
  for (const listener of listeners) listener();
}
/** @param {() => void} listener */
export function onReadFailure(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
