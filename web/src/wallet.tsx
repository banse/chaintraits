import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import {
  createConfig,
  http,
  useAccount,
  useConnect,
  useConnectors,
  useDisconnect,
  useConfig,
} from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { getAddress } from "viem";
import { type Runtime, explain } from "./chain";
import { WALLET_ICONS } from "./wallet-icons";
import { connectedProvider } from "./controllers/wallet-connection.mjs";
export { connectedProvider } from "./controllers/wallet-connection.mjs";
export function walletConfig(r: Runtime) {
  return createConfig({
    chains: [r.chain],
    multiInjectedProviderDiscovery: true,
    connectors: [
      injected(),
      coinbaseWallet({
        appName: "Sworn",
        appLogoUrl: new URL("favicon.svg", document.baseURI).href,
        preference: { options: "all" },
      }),
    ],
    transports: { [r.chain.id]: http(r.deployment.network.rpcUrls[0]) },
  });
}
export const OPEN_IN = [
  {
    id: "metamask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
const WalletContext = createContext({ open: () => {} });
export const useWalletSheet = () => useContext(WalletContext);
export function WalletProvider({
  r,
  children,
}: {
  r: Runtime;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");
  const account = useAccount();
  const { connectAsync } = useConnect();
  const connectors = useConnectors();
  const { disconnect } = useDisconnect();
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !connectors.some((c) => c.type === "injected" && c.id !== "injected") &&
    !(window as any).ethereum;
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const listed = connectors.filter(
    (c) =>
      !(c.id === "injected" && named) && (!mobile || c.type !== "injected"),
  );
  useEffect(() => {
    if (account.isConnected) dialog.current?.close();
  }, [account.isConnected]);
  const open = () => {
    setError("");
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  return (
    <WalletContext.Provider value={{ open }}>
      {children}
      <dialog
        ref={dialog}
        className="wallet-sheet"
        onClick={(e) => {
          if (e.target === dialog.current) {
            const rect = dialog.current.getBoundingClientRect();
            if (
              e.clientX < rect.left ||
              e.clientX > rect.right ||
              e.clientY < rect.top ||
              e.clientY > rect.bottom
            )
              close();
          }
        }}
        aria-labelledby="wallet-title"
      >
        <div className="sheet-head">
          <h2 id="wallet-title">Connect a Wallet</h2>
          <button
            aria-label="Close wallet picker"
            className="close"
            onClick={close}
          >
            ×
          </button>
        </div>
        {mobile &&
          OPEN_IN.map((w) => (
            <a className="wallet-row" key={w.id} href={w.href(location.href)}>
              <img src={WALLET_ICONS[w.id]} width="28" height="28" alt="" />
              Open in {w.name}
            </a>
          ))}
        {listed.map((c) => (
          <button
            className="wallet-row"
            key={c.uid}
            disabled={!!pending}
            onClick={async () => {
              setError("");
              setPending(c.uid);
              try {
                await connectAsync({ connector: c });
                close();
              } catch (e) {
                setError(explain(e));
              } finally {
                setPending("");
              }
            }}
          >
            {c.icon ||
            WALLET_ICONS[c.id === "coinbaseWalletSDK" ? "coinbase" : c.id] ? (
              <img
                src={c.icon || WALLET_ICONS.coinbase}
                width="28"
                height="28"
                alt=""
              />
            ) : (
              <svg
                width="28"
                height="28"
                aria-hidden="true"
                viewBox="0 0 28 28"
              >
                <rect
                  x="2"
                  y="5"
                  width="24"
                  height="18"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                />
                <path d="M18 11h8v7h-8Z" fill="none" stroke="currentColor" />
              </svg>
            )}
            <span>
              {c.id === "injected"
                ? "Browser wallet"
                : c.id === "coinbaseWalletSDK" && mobile
                  ? "Coinbase Smart Wallet"
                  : c.name}
              {pending === c.uid ? " · opening…" : ""}
            </span>
          </button>
        ))}
        <p role="status" className="danger">
          {error}
        </p>
        <p className="muted">
          Your wallet asks before sharing an address. Connecting sends no
          transaction.
        </p>
      </dialog>
    </WalletContext.Provider>
  );
}
export function SwitchNetworkButton({
  r,
  className = "primary",
}: {
  r: Runtime;
  className?: string;
}) {
  const { connector } = useAccount();
  const config = useConfig();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function switchChain() {
    setBusy(true);
    setError("");
    try {
      const provider: any = await connectedProvider(
        config.connectors,
        connector,
      );
      if (!provider)
        throw Error("Wallet unavailable. Reconnect and try again.");
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: r.deployment.walletAddChain.chainId }],
        });
      } catch (e: any) {
        if (e.code === 4902 || e.cause?.code === 4902) {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [r.deployment.walletAddChain],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: r.deployment.walletAddChain.chainId }],
          });
        } else throw e;
      }
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="network-action">
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={switchChain}
      >
        {busy ? "Switching…" : "Switch to Ethereum"}
      </button>
      {error && (
        <p role="status" className="danger">
          {error}
        </p>
      )}
    </div>
  );
}
export function ConnectControl({ r }: { r: Runtime }) {
  const { open } = useWalletSheet();
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  return (
    <div className="connect-control">
      {!isConnected ? (
        <button className="secondary" onClick={open}>
          Connect
        </button>
      ) : chainId !== r.deployment.chainId ? (
        <SwitchNetworkButton r={r} className="secondary" />
      ) : (
        <button
          className="secondary"
          onClick={() => disconnect()}
          title={address}
        >
          {getAddress(address!).slice(0, 6)}…{getAddress(address!).slice(-4)} ·
          Disconnect
        </button>
      )}
    </div>
  );
}
