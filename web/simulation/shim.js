// Loaded before the Sworn bundle in the local mock only. It sends every chain read, wallet call and
// api.imd.fun read to the local server, refuses every other request that would leave this origin,
// replaces any wallet extension with a mock wallet for the sample accounts, and shows a small panel.
(() => {
  "use strict";
  const ORIGIN = location.origin;
  const RPC = /^(ethereum-rpc\.publicnode\.com|gateway\.tenderly\.co|rpc\.mevblocker\.io|1\.rpc\.thirdweb\.com|eth\.drpc\.org|eth\.merkle\.io|cloudflare-eth\.com|eth\.llamarpc\.com|rpc\.ankr\.com|mainnet\.infura\.io)$/;
  const realFetch = window.fetch.bind(window);
  const state = { active: null, wallets: [], exactIntake: false, nextAnswer: "auto", blocked: [] };
  const blockedHere = [];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function report(url) {
    blockedHere.push(url);
    renderPanel();
    realFetch("/__mock__/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blocked: url }) }).catch(() => {});
  }
  const urlOf = (input) => (typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || String(input));

  window.fetch = async function (input, init = {}) {
    const raw = urlOf(input);
    let u;
    try {
      u = new URL(raw, location.href);
    } catch {
      return realFetch(input, init);
    }
    if (u.origin === ORIGIN) return realFetch(input, init);
    const method = (init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (RPC.test(u.hostname) || (method === "POST" && /"jsonrpc"\s*:/.test(typeof init.body === "string" ? init.body : ""))) {
      const body = typeof init.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
      return realFetch("/__mock__/rpc", { method: "POST", headers: { "content-type": "application/json" }, body, signal: init.signal });
    }
    if (u.hostname === "api.imd.fun") {
      const r = await realFetch(`/__mock__/api${u.pathname}${u.search}`, { signal: init.signal });
      // Live, /intake answers without a CORS header, so a browser refuses it. Mirror that unless switched on.
      if (r.headers.get("x-mock-cors") === "refuse") throw new TypeError("Failed to fetch");
      return r;
    }
    report(`${method} ${u.href}`);
    throw new TypeError("Failed to fetch (the local mock sends nothing off this machine)");
  };

  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = new RealXHR();
    const open = x.open;
    x.open = function (method, url, ...rest) {
      const u = new URL(url, location.href);
      if (u.origin !== ORIGIN) {
        report(`${method} ${u.href} (XHR)`);
        throw new TypeError("XHR blocked by the local mock");
      }
      return open.call(x, method, url, ...rest);
    };
    return x;
  };
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    report(`WebSocket ${url}`);
    throw new TypeError("WebSocket blocked by the local mock");
  };
  window.WebSocket.prototype = RealWS.prototype;
  if (navigator.sendBeacon) navigator.sendBeacon = (url) => (report(`beacon ${url}`), false);

  // ---- mock wallet -------------------------------------------------------------------------
  const listeners = {};
  const emit = (ev, arg) => (listeners[ev] || []).forEach((f) => { try { f(arg); } catch {} });
  let connected = sessionStorage.getItem("sworn-mock-connected") === "yes";
  let rpcId = 0;
  async function rpc(method, params) {
    const r = await realFetch("/__mock__/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    const b = await r.json();
    if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.code, data: b.error.data });
    return b.result;
  }
  const SIGNING = /^(eth_sign|personal_sign|eth_signTypedData|wallet_sendCalls|eth_sendRawTransaction)/;
  const provider = {
    isMockWallet: true,
    isMetaMask: false,
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); return provider; },
    removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); return provider; },
    off(ev, f) { return provider.removeListener(ev, f); },
    async request({ method, params = [] }) {
      if (/^(eth_accounts|eth_requestAccounts|eth_sendTransaction)$/.test(method)) await ready;
      const accounts = () => (connected && state.active ? [state.active] : []);
      switch (method) {
        case "eth_chainId": return "0x1";
        case "net_version": return "1";
        case "eth_accounts": return accounts();
        case "eth_requestAccounts":
          connected = true;
          sessionStorage.setItem("sworn-mock-connected", "yes");
          emit("connect", { chainId: "0x1" });
          return accounts();
        case "wallet_requestPermissions":
          connected = true;
          sessionStorage.setItem("sworn-mock-connected", "yes");
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_getPermissions": return connected ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          connected = false;
          sessionStorage.removeItem("sworn-mock-connected");
          emit("accountsChanged", []);
          return null;
        case "wallet_switchEthereumChain":
          if (params[0]?.chainId?.toLowerCase() === "0x1") return null;
          throw Object.assign(new Error("The mock wallet knows only Ethereum (chain 1)."), { code: 4902 });
        case "wallet_addEthereumChain": return null;
        case "wallet_getCapabilities": return {};
        case "eth_sendTransaction": {
          if (!connected) throw Object.assign(new Error("Connect the mock wallet first."), { code: 4100 });
          const r = await realFetch("/__mock__/wallet", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ method, params }),
          });
          const b = await r.json();
          if (b.error) throw Object.assign(new Error(b.error.message), { code: b.error.code, data: b.error.data });
          return b.result;
        }
      }
      if (SIGNING.test(method)) throw Object.assign(new Error(`The mock wallet does not support ${method}.`), { code: 4200 });
      return rpc(method, params);
    },
  };
  const info = {
    uuid: "7b0a3b8e-5c1e-4b8a-9d2f-5a0c1a1c1a1c",
    name: "Mock wallet (local)",
    rdns: "local.sworn.mock",
    icon:
      "data:image/svg+xml;base64," +
      btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0a0a0a"/><path d="M8 16h16M16 8v16" stroke="#6bff8e" stroke-width="3"/></svg>'),
  };
  // A real wallet extension never reaches this page: its announcements are stopped before the
  // site hears them, and any provider it left behind refuses to sign.
  const guard = (p) => {
    if (!p || p === provider || p.__swornMockGuard) return;
    try {
      const real = p.request?.bind(p);
      p.request = async (a) => {
        if (/^(eth_send|eth_sign|personal_sign|wallet_send|eth_signTypedData)/.test(a?.method || ""))
          throw Object.assign(new Error("Blocked: a real wallet cannot sign on the local mock."), { code: 4100 });
        return real ? real(a) : undefined;
      };
      p.__swornMockGuard = true;
    } catch {}
  };
  let foreign = false;
  try {
    guard(window.ethereum);
    Object.defineProperty(window, "ethereum", { configurable: true, get: () => provider, set: (v) => guard(v) });
  } catch {
    foreign = true;
  }
  if (window.ethereum !== provider) foreign = true;
  window.addEventListener(
    "eip6963:announceProvider",
    (e) => {
      if (e.detail?.provider !== provider) {
        guard(e.detail?.provider);
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  // Explorer links open the local stand-in page.
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target?.closest?.("a[href^='https://explorer.imd.fun/jobs/']");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      open(`/__mock__/explorer/jobs/${a.href.split("/jobs/")[1]}`, "_blank", "noopener");
    },
    true,
  );

  // ---- panel ---------------------------------------------------------------------------------
  let ready;
  let panel, collapsed = sessionStorage.getItem("sworn-mock-panel") !== "open", delayControlsOpen = false;
  const delayLabels = {
    preflightSeconds: "Preflight gas estimate", walletSeconds: "Wallet confirmation",
    approvalSeconds: "IMD approval mining", transactionSeconds: "Fact transaction mining",
    pickup: "Swarm admission", firstAnswerSeconds: "First agent answer",
    answerEverySeconds: "Between agent answers", attestAfterSeconds: "Signed result after quorum",
    deliverAfterSeconds: "Delivery submission", registrySeconds: "Registry transaction mining",
    artworkSeconds: "Card artwork read",
  };
  async function post(body) {
    const r = await realFetch("/__mock__/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    Object.assign(state, await r.json());
    renderPanel();
  }
  async function load() {
    try {
      const r = await realFetch("/__mock__/state");
      const before = state.active;
      Object.assign(state, await r.json());
      if (before !== state.active && connected) emit("accountsChanged", [state.active]);
      renderPanel();
    } catch {}
  }
  ready = load();
  function renderPanel() {
    if (!document.body) return;
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "sworn-mock-panel";
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", "Local mock controls");
      document.body.prepend(panel);
      const css = document.createElement("style");
      css.textContent = `#sworn-mock-panel{position:relative;margin:12px;max-width:100%;
background:#0c0c0c;color:#d7d7d7;border:1px solid #2a2a2a;font:12px/1.45 ui-monospace,Menlo,monospace;padding:8px 10px}
#sworn-mock-panel b{color:#6bff8e;font-weight:600}#sworn-mock-panel select,#sworn-mock-panel button{font:inherit;background:#111;color:#d7d7d7;border:1px solid #333;padding:2px 6px;margin:2px 0;max-width:100%}
#sworn-mock-panel label{display:block;margin-top:4px}#sworn-mock-panel .warn{color:#ff6b6b}#sworn-mock-panel .row{display:flex;gap:6px;align-items:center;justify-content:space-between}`;
      document.head.appendChild(css);
    }
    const blocked = blockedHere.length;
    if (collapsed) {
      panel.innerHTML = `<div class=row><b>LOCAL SIMULATION · NOT PROOF</b><button data-a=open aria-label="Open mock controls">open</button></div>`;
    } else {
      panel.innerHTML = `<div class=row><b>LOCAL SIMULATION · sample data</b><button data-a=close aria-label="Hide mock controls">hide</button></div>
${foreign ? `<div class=warn>A wallet extension controls this page. Open the mock in a browser profile without wallet extensions.</div>` : ""}
<label>Wallet <select data-a=wallet>${state.wallets.map((w) => `<option value="${esc(w.address)}" ${w.address === state.active ? "selected" : ""}>${esc(w.label)}</option>`).join("")}</select></label>
<label>Next panel answers <select data-a=answer>${["auto", "true", "false", "split", "stall"].map((x) => `<option ${x === state.nextAnswer ? "selected" : ""}>${x}</option>`).join("")}</select></label>
<label>Delivery <select data-a=delivery>${["normal", "hold", "starved"].map((x) => `<option ${x === state.delivery ? "selected" : ""}>${x}</option>`).join("")}</select></label>
<details data-delays ${delayControlsOpen ? 'open' : ''}><summary>Delays (seconds)</summary><p>Transaction and swarm delays are fixed at submission. Read delays apply to the next read.</p>${Object.entries(delayLabels).map(([k, label]) => `<label>${esc(label)} <input type=number min=0 max=600 step=any data-delay="${esc(k)}" value="${esc(state.settings?.[k] ?? (k === "approvalSeconds" ? "" : 0))}" ${k === "approvalSeconds" ? 'placeholder="inherit"' : ''} style="width:75px"></label>`).join("")}<p>Leave approval mining blank to use the fact transaction delay.</p></details>
${(state.records || []).slice(-3).map(r => `<div>Fact ${esc(r.factId)}: ${esc(r.status)} · ${r.members}/${r.quorum}${r.status === "attested" && !r.attempted ? `<button data-release="${esc(r.oracleId)}">Release delivery</button>` : r.attempted && !r.delivered && !r.recoveryReceipt ? `<button data-recover="${esc(r.oracleId)}">Recover callback</button>` : ""}</div>`).join("")}
<label><input type=checkbox data-a=intake ${state.exactIntake ? "checked" : ""}> /intake readable (CORS on)</label>
<div class=row><span>${state.chainTime ? `chain time ${esc(new Date(state.chainTime * 1000).toISOString().slice(0, 16).replace("T", " "))}` : ""}</span><button data-a=advance>+32 days</button></div>
<div class=row><span>${blocked ? `<span class=warn>${blocked} blocked request${blocked > 1 ? "s" : ""}</span>` : "0 requests left this machine"}</span><button data-a=reset>reset chain</button></div>`;
    }
    const delayControls = panel.querySelector('[data-delays]');
    if (delayControls) delayControls.ontoggle = () => { if (delayControls.isConnected) delayControlsOpen = delayControls.open; };
    panel.querySelectorAll("[data-delay]").forEach(el => { el.onchange = () => {
      if (!el.checkValidity() || (el.value === "" && el.dataset.delay !== "approvalSeconds")) return;
      post({ [el.dataset.delay]: el.value === "" ? null : Number(el.value) });
    }; });
    panel.querySelectorAll("[data-release]").forEach(el => { el.onclick = () => post({ releaseDelivery: el.dataset.release }); });
    panel.querySelectorAll("[data-recover]").forEach(el => { el.onclick = () => post({ recoverDelivery: el.dataset.recover }); });
    panel.querySelectorAll("[data-a]").forEach((el) => {
      const a = el.dataset.a;
      if (a === "open" || a === "close")
        el.onclick = () => {
          collapsed = a === "close";
          sessionStorage.setItem("sworn-mock-panel", collapsed ? "closed" : "open");
          renderPanel();
        };
      if (a === "wallet")
        el.onchange = async () => {
          await post({ active: el.value });
          emit("accountsChanged", connected ? [state.active] : []);
        };
      if (a === "answer") el.onchange = () => post({ nextAnswer: el.value });
      if (a === "intake") el.onchange = () => post({ exactIntake: el.checked });
      if (a === "delivery") el.onchange = () => post({ delivery: el.value });
      if (a === "advance") el.onclick = () => post({ advanceDays: 32 });
      if (a === "reset")
        el.onclick = async () => {
          el.disabled = true;
          el.textContent = "resetting…";
          await post({ reset: true });
          location.reload();
        };
      if (blocked && a === "reset") el.title = blockedHere.join("\n");
    });
  }
  document.addEventListener("DOMContentLoaded", renderPanel);
  setInterval(() => { if (!panel?.contains(document.activeElement)) load(); }, 1500);
})();
