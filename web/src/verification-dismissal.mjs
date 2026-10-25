const PREFIX='sworn.mainnet.dismissed-verification:';
export function verificationDismissalKey({chainId,registry,account,requestId}) {
  return PREFIX+[chainId,registry,account,requestId].join(':').toLowerCase();
}
export function verificationDismissed(storage,key) {
  try { return storage.getItem(key)==='1'; } catch { return false; }
}
export function dismissVerification(storage,key) {
  try { storage.setItem(key,'1'); } catch { /* The component also retains dismissal in memory. */ }
}
