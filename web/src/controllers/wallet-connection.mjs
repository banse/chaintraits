// Resolve against wagmi's current connector list, never a stale saved provider.
export async function connectedProvider(connectors, saved) {
  const live = connectors.find(c => c.uid === saved?.uid) ||
    connectors.find(c => c.id === saved?.id);
  if (!live || typeof live.getProvider !== 'function')
    throw Error('Reconnect your wallet to restore its provider.');
  const provider = await live.getProvider();
  if (!provider || typeof provider.request !== 'function')
    throw Error('The wallet provider is unavailable. Reconnect your wallet.');
  return provider;
}

// Recheck at the transport boundary: slow preflight reads must not preserve
// authorization across a wallet, connector or network change.
export function assertWalletContext(current, expected) {
  const selected = expected.connector;
  const sameConnector = !selected || (selected.uid
    ? current?.connector?.uid === selected.uid
    : current?.connector?.id === selected.id);
  if (!current?.address || current.address.toLowerCase() !== expected.address.toLowerCase() ||
      current.chainId !== expected.chainId || !sameConnector)
    throw Error('Wallet or network changed. Prepare again.');
}
