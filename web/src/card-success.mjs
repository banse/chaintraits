const PREFIX = 'sworn.mainnet.dismissed-card:';
export function cardSuccessKey({chainId, registry, account, token, hash}) {
  return PREFIX + [chainId, registry, account, token, hash || ''].join(':').toLowerCase();
}
export function cardSuccessDismissed(storage, key) {
  try { return storage.getItem(key) === '1'; } catch { return false; }
}
export function dismissCardSuccess(storage, key) {
  try { storage.setItem(key, '1'); } catch { /* Keep the current UI dismissible if storage is unavailable. */ }
}
