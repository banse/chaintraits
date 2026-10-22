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
import {
  Home,
  Catalog,
  Explorer,
  FactArtifact,
  Integrate,
  WhitelistCurator,
  About,
} from "./pages";
import { Claim } from "./claim";
import { WalletFacts } from "./wallet-facts";
import { READ_RPCS } from "./rpc.mjs";
function routeInfo() {
  const hash = location.hash.slice(1) || "/";
  const [path, rest] = hash.split("#");
  const requested = path.split("?")[0];
  const route =
    requested === "/claim"
      ? "/mint"
      : requested === "/wallet-facts"
        ? "/wallet"
        : requested;
  return {
    route,
    anchor:
      rest === "shared-fact"
        ? "pick-1201"
        : rest?.replace(/^shared-(\d+)$/, "pick-$1"),
    query: new URLSearchParams(path.split("?")[1]),
  };
}
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
      setError(
        "Cannot read the chain, retrying. Use Retry reads to try again now.",
      );
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
      ROUTES.find(([path]) => path === route.route)?.[1] || "Page not found";
    document.title = `Sworn | ${label}`;
    const timeout = setTimeout(() => {
      const trait = route.query.get("trait");
      const id =
        route.anchor ||
        (trait
          ? route.route === "/mint"
            ? `pick-${trait}`
            : `trait-${trait}`
          : "");
      if (id) {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ block: "start" });
          if (el instanceof HTMLInputElement) el.focus();
          return;
        }
      }
      document.getElementById("main")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }, 100);
    return () => clearTimeout(timeout);
  }, [route]);
  const pages: Record<string, React.ComponentType> = {
    "/": Home,
    "/catalog": Catalog,
    "/explorer": Explorer,
    "/mint": Claim,
    "/wallet": WalletFacts,
    "/fact-vs-artifact": FactArtifact,
    "/integrate": Integrate,
    "/whitelistcurator": WhitelistCurator,
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
          <img src={asset("favicon.svg")} width="32" height="32" alt="" />
          <span>SWORN</span>
        </a>
        <nav aria-label="Main navigation">
          {ROUTES.filter(([path]) => path !== "/").map(([path, name]) => (
            <a
              key={path}
              href={`#${path}`}
              aria-current={route.route === path ? "page" : undefined}
            >
              {name}
            </a>
          ))}
          <a href={asset("agents/sworn/SKILL.md")}>Agents</a>
        </nav>
        <ConnectControl r={r} />
      </header>
      <main id="main" tabIndex={-1} key={route.route + route.query.toString()}>
        {Page ? (
          <Page />
        ) : (
          <>
            <h1>Page not found</h1>
            <a href="#/">Return to Sworn</a>
          </>
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <a className="brand" href="#/">
            SWORN
          </a>
          <span>An ownerless registry on Ethereum.</span>
          <a href="#/fact-vs-artifact">A fact is not an artifact ↗</a>
        </div>
        <ContractList />
        <div className="rpc-controls">
          <label htmlFor="rpc-choice">Public RPC</label>
          <select
            id="rpc-choice"
            value={rpcUrl}
            onChange={(e) => setRpcUrl(e.target.value)}
          >
            {Array.from(new Set(READ_RPCS)).map((url) => (
              <option key={url} value={url}>
                {new URL(url).hostname}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setReadRetry((n) => n + 1);
              void refresh();
            }}
            disabled={loading}
          >
            {loading ? "Checking…" : "Retry reads"}
          </button>
        </div>
        <Status error={!!error}>
          {error ||
            (health
              ? `Dependencies verified · Ethereum block ${health.block.toLocaleString("en-US")} · priceOf read live`
              : "Checking deployment and dependencies…")}
        </Status>
        <div className="footer-bottom">
          <span>No owner. No backend. No coin.</span>
          <a href={asset("imd-deployment.json")}>Deployment manifest ↗</a>
          <a href="#/about">About & sources ↗</a>
        </div>
      </footer>
    </SiteContext.Provider>
  );
}
