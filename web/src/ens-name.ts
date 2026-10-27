import { useEffect, useState } from "react";
import { createPublicClient, custom } from "viem";
import { useSite } from "./context";

const names = new Map<string, Promise<string | null>>();
// The site's RPC pool without CCIP-read: a name behind an offchain resolver is not shown rather than fetched
// from a third-party gateway by the visitor's browser.
const ensClients = new WeakMap<object, any>();
const ensClient = (client: any) => {
  if (!client?.pool || !client.runtime?.chain) return client;
  if (!ensClients.has(client.pool))
    ensClients.set(
      client.pool,
      createPublicClient({
        chain: client.runtime.chain,
        transport: custom(client.pool, { retryCount: 0 }),
        ccipRead: false,
      }),
    );
  return ensClients.get(client.pool);
};

/** A wallet's primary ENS name, read on mainnet (viem's getEnsName: the reverse record, checked by forward
 *  resolution in the Universal Resolver); null while unread, without a name, offchain-only, or without a site client. */
export function usePrimaryName(wallet: string | undefined) {
  const client = useSite()?.client;
  const [found, setFound] = useState<{ wallet: string; name: string | null }>();
  const key = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : "";
  useEffect(() => {
    if (!client || !key) return;
    if (!names.has(key))
      names.set(
        key,
        Promise.resolve(ensClient(client).getEnsName({ address: wallet })).catch(() => {
          names.delete(key);
          return null;
        }),
      );
    let live = true;
    names.get(key)!.then((name) => {
      if (live) setFound({ wallet: key, name: name || null });
    });
    return () => {
      live = false;
    };
  }, [client, key]);
  return found && found.wallet === key ? found.name : null;
}
