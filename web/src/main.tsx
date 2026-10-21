import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadRuntime, explain } from "./chain";
import { walletConfig, WalletProvider } from "./wallet";
import { App } from "./App";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
loadRuntime()
  .then((r) => {
    const config = walletConfig(r);
    const query = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
    });
    root.render(
      <WagmiProvider config={config}>
        <QueryClientProvider client={query}>
          <WalletProvider r={r}>
            <App r={r} />
          </WalletProvider>
        </QueryClientProvider>
      </WagmiProvider>,
    );
  })
  .catch((e) =>
    root.render(
      <main className="startup-error">
        <h1>Sworn could not load</h1>
        <p role="alert">{explain(e)}</p>
        <button onClick={() => location.reload()}>Retry loading</button>
      </main>,
    ),
  );
