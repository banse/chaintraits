import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  type Runtime,
  type Health,
  makeClient,
  health as readHealth,
  community,
  explain,
  asset,
} from "./chain";
import { SiteContext } from "./context";
import { ConnectControl } from "./wallet";
import { ROUTES } from "./data";
import { ContractList, Status } from "./components";
import { Home, Catalog, Integrate, About } from "./pages";
import { Claim } from "./claim";
import {
  TransactionProvider,
  TransactionJournalSlot,
  TransactionTopProgress,
} from "./transactions";
import { SwarmProgressProvider } from "./swarm";
import { routeInfo, TASKS } from "./task-navigation.mjs";
import { WalletFacts } from "./wallet-facts";
import { Curator } from "./curator";
import { READ_RPCS } from "./rpc.mjs";
import { onReadFailure, RECOVERY_MS } from "./read-recovery.mjs";
const FOOTER_LINKS: [string, string][] = [
  [
    "Source repository ↗",
    "https://github.com/identity-md-launches/launch-2404-renderer-composer-registry",
  ],
  ["Identity.md ↗", "https://imd.fun"],
  ["IMD agents ↗", "https://imd.fun/docs"],
  ["Sworn on X ↗", "https://x.com/swornbyswarm"],
];
export function App({ r }: { r: Runtime }) {
  const [route, setRoute] = useState(routeInfo);
  const [rpcUrl, setRpcUrlState] = useState(() => {
    try {
      return READ_RPCS.includes(localStorage.getItem("sworn.public-rpc") || "")
        ? localStorage.getItem("sworn.public-rpc")!
        : READ_RPCS[0];
    } catch {
      return READ_RPCS[0];
    }
  });
  const [health, setHealth] = useState<Health | null>(null);
  const [readRetry, setReadRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [specs, setSpecs] = useState<any[]>([]);
  const [specError, setSpecError] = useState("");
  const refreshId = useRef(0);
  const client = useMemo(() => makeClient(r, rpcUrl), [r, rpcUrl]);
  const refresh = useCallback(async () => {
    const ticket = ++refreshId.current;
    setLoading(true);
    setError("");
    try {
      const result = await readHealth(client, r);
      if (ticket !== refreshId.current) return;
      setHealth(result);
      try {
        const list = await community(client, r);
        if (ticket !== refreshId.current) return;
        setSpecs(list);
        setSpecError("");
      } catch (e) {
        setSpecs([]);
        setSpecError(`Community specs unavailable. ${explain(e)}`);
      }
    } catch (e) {
      if (ticket !== refreshId.current) return;
      setHealth(null);
      setError("Cannot read the chain, retrying.");
    } finally {
      if (ticket === refreshId.current) setLoading(false);
    }
  }, [client, r]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 45000);
    return () => {
      ++refreshId.current;
      clearInterval(id);
    };
  }, [refresh]);
  // Reads fall back across the RPC pool by themselves. When a read exhausted
  // the pool, every failed read runs again after a short, growing pause.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const stop = onReadFailure(() => {
      if (timer) return;
      const wait = RECOVERY_MS[Math.min(attempt, RECOVERY_MS.length - 1)];
      attempt++;
      timer = setTimeout(() => {
        timer = undefined;
        setReadRetry((n) => n + 1);
        void refresh();
      }, wait);
    });
    // A quiet minute resets the pause to its shortest.
    const reset = setInterval(() => {
      if (!timer) attempt = 0;
    }, 60000);
    return () => {
      stop();
      clearTimeout(timer);
      clearInterval(reset);
    };
  }, [refresh]);
  function setRpcUrl(value: string) {
    ++refreshId.current;
    setHealth(null);
    setRpcUrlState(value);
    try {
      localStorage.setItem("sworn.public-rpc", value);
    } catch {}
  }
  useEffect(() => {
    function change() {
      setRoute(routeInfo());
    }
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const label =
      TASKS.find(([path]) => path === route.route)?.[1] ||
      ROUTES.find(([path]) => path === route.route)?.[1] ||
      "Page not found";
    document.title = `Sworn | ${label}`;
    // Establish route focus before the visitor starts typing. A delayed anchor
    // observer must never steal focus back from an already-used form.
    const main = document.getElementById("main");
    main?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    let observer: MutationObserver | undefined;
    const timeout = setTimeout(() => {
      const trait = route.query.get("trait");
      const id =
        route.anchor ||
        (trait
          ? route.route === "/request"
            ? `pick-${trait}`
            : `trait-${trait}`
          : "");
      const scrollToTarget = () => {
        if (!id) return false;
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ block: "start" });
          if (el instanceof HTMLInputElement) el.focus();
          observer?.disconnect();
          return true;
        }
        return false;
      };
      if (scrollToTarget()) return;
      if (id && main) {
        // Community rows and wallet history can arrive after navigation.
        // Stop watching after the first match or when the route changes.
        observer = new MutationObserver(scrollToTarget);
        observer.observe(main, { childList: true, subtree: true });
      }
    }, 100);
    return () => {
      clearTimeout(timeout);
      observer?.disconnect();
    };
  }, [route]);
  const pages: Record<string, React.ComponentType> = {
    "/": Home,
    "/catalog": Catalog,
    "/wallet": WalletFacts,
    "/curator": Curator,
    "/integrate": Integrate,
    "/about": About,
  };
  const Page = pages[route.route];
  return (
    <SiteContext.Provider
      value={{
        r,
        client,
        health,
        error,
        loading,
        refresh,
        readRetry,
        rpcUrl,
        setRpcUrl,
        specs,
        specError,
      }}
    >
      <TransactionProvider>
        <SwarmProgressProvider>
          <a
            className="skip-link"
            href="#main"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("main")?.focus();
            }}
          >
            Skip to content
          </a>
          <header className="site-header">
            <a className="brand" href="#/" aria-label="Sworn home">
              <img
                src={asset("art/full-house.svg")}
                width="40"
                height="40"
                alt=""
              />
              <span>SWORN</span>
            </a>
            <nav aria-label="Main navigation">
              {ROUTES.filter(([path]) => path !== "/").map(([path, name]) => (
                <a
                  key={path}
                  href={`#${path}`}
                  aria-current={
                    route.route === path ||
                    (path === "/mint" &&
                      route.route === "/request")
                      ? "page"
                      : undefined
                  }
                >
                  {name}
                </a>
              ))}
              <a href={asset("docs/index.html")}>Docs</a>
              <a href={asset("agents/sworn/SKILL.md")}>Agents</a>
            </nav>
            <ConnectControl r={r} />
          </header>
          <main
            id="main"
            tabIndex={-1}
            key={
              TASKS.some(([path]) => path === route.route)
                ? "tasks"
                : route.route + route.query.toString()
            }
          >
            {TASKS.some(([path]) => path === route.route) && (
              <TransactionTopProgress task={route.route} />
            )}
            {TASKS.some(([path]) => path === route.route) ? (
              <Claim task={route.route} />
            ) : Page ? (
              <Page />
            ) : (
              <>
                <h1>Page not found</h1>
                <a href="#/">Return to Sworn</a>
              </>
            )}
            <TransactionJournalSlot />
          </main>
          <footer className="site-footer">
            <div className="footer-top">
              <a className="brand" href="#/">
                SWORN
              </a>
              <span>An ownerless registry on Ethereum.</span>
              <a href="#/integrate#fact-vs-artifact">
                A fact is not an artifact ↗
              </a>
            </div>
            <ContractList />
            <Status error={!!error}>
              {error ||
                (health
                  ? `Ethereum mainnet · block ${health.block.toLocaleString("en-US")} · current oracle quote`
                  : "Checking Ethereum mainnet…")}
            </Status>
            <div className="footer-bottom">
              <span>Sworn on Ethereum: no owner and no native coin.</span>
              {FOOTER_LINKS.map(([label, href]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </div>
          </footer>
        </SwarmProgressProvider>
      </TransactionProvider>
    </SiteContext.Provider>
  );
}
