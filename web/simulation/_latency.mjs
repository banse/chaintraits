// Pure classifiers for local simulator waits; they never submit a transaction or sleep.
import { decodeFunctionData, multicall3Abi, parseAbi } from 'viem';

const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
const approvalAbi = parseAbi(['function approve(address spender, uint256 amount)']);
const artworkAbi = parseAbi([
  'function tokenURI(uint256 token) view returns (string)',
  'function tokenURIOf(address registry, uint256 token) view returns (string)',
]);
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function decode(call, abi) {
  try { return decodeFunctionData({ abi, data: call?.data ?? call?.input }); }
  catch { return null; }
}

export function walletTiming(transaction, settings, addresses) {
  const isApproval = sameAddress(transaction?.to, addresses.imd)
    && decode(transaction, approvalAbi)?.functionName === 'approve';
  return {
    walletSeconds: settings.walletSeconds ?? 0,
    miningSeconds: isApproval ? settings.approvalSeconds ?? settings.transactionSeconds : settings.transactionSeconds,
    isApproval,
  };
}

function artworkRead(call, addresses) {
  if (!sameAddress(call?.to, addresses.registry) && !sameAddress(call?.to, addresses.renderer)) return false;
  const decoded = decode(call, artworkAbi);
  return sameAddress(call.to, addresses.registry) && decoded?.functionName === 'tokenURI'
    || sameAddress(call.to, addresses.renderer) && decoded?.functionName === 'tokenURIOf'
      && sameAddress(decoded.args[0], addresses.registry);
}

export function rpcDelaySeconds({ method, params = [] }, settings, addresses) {
  if (method === 'eth_estimateGas') return settings.preflightSeconds ?? 0;
  if (method !== 'eth_call') return 0;
  const call = params[0];
  let artwork = artworkRead(call, addresses);
  if (!artwork && sameAddress(call?.to, multicall)) {
    const batch = decode(call, multicall3Abi);
    artwork = batch?.functionName === 'aggregate3' && batch.args[0].some(
      item => artworkRead({ to: item.target, data: item.callData }, addresses),
    );
  }
  return artwork ? settings.artworkSeconds ?? 0 : 0;
}
