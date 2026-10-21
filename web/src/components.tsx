import { HIVE_CELLS } from "./hive-layout";
import { useState, useRef, type ReactNode } from "react";
import { isAddress, getAddress } from "viem";
import { useSite } from "./context";
import { asset, explain, type WalletFacts } from "./chain";
import { completion } from "./settlement";
import { FAMILIES, TRAITS } from "./data";
import { imd } from "./pure.mjs";
export const num = (n: bigint | number) => n.toLocaleString("en-US");
export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
export function Status({
  error,
  children,
}: {
  error?: boolean;
  children?: ReactNode;
}) {
  return (
    <p className={error ? "status danger" : "status muted"} role="status">
      {children}
    </p>
  );
}
export function Mark({ kind, rare = false }: { kind: string; rare?: boolean }) {
  return (
    <span className={`class-mark ${kind}`}>
      {rare && (
        <span className="rare" aria-label="Rare">
          ●{" "}
        </span>
      )}
      {kind === "chain"
        ? "Chain-proven"
        : kind === "panel"
          ? "Panel-sworn"
          : kind === "direct"
            ? "Direct"
            : "Shared"}
    </span>
  );
}
export function AddressForm({
  initial = "",
  onSubmit,
}: {
  initial?: string;
  onSubmit?: (a: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="address-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isAddress(value, { strict: false })) {
          setError(
            "Enter an Ethereum address: 0x followed by 40 hexadecimal characters.",
          );
          input.current?.focus();
          return;
        }
        setError("");
        const a = getAddress(value);
        if (onSubmit) onSubmit(a);
        else location.hash = `/explorer?address=${a}`;
      }}
    >
      <label htmlFor="explore-address">Explore a wallet</label>
      <div className="input-action">
        <input
          ref={input}
          id="explore-address"
          name="address"
          spellCheck={false}
          autoComplete="off"
          placeholder="0x… (42 characters)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!error}
          aria-describedby="address-error"
        />
        <button className="primary" type="submit">
          Explore wallet <span aria-hidden="true">↗</span>
        </button>
      </div>
      <Status error={!!error}>
        {error || "Public facts. No wallet connection needed."}
      </Status>
    </form>
  );
}
export function ContractList() {
  const { r } = useSite();
  return (
    <dl className="contracts">
      {r.deployment.contracts.map((c) => (
        <div key={c.name}>
          <dt>{c.name}</dt>
          <dd>
            <a
              href={`${r.deployment.network.explorer}/address/${c.address}#code`}
              target="_blank"
              rel="noreferrer"
            >
              {c.address}
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Sources({
  part = "3-trait-table-25-slots-working-names",
  label = "CATALOG · facts and rules",
}: {
  part?: string;
  label?: string;
}) {
  const { r } = useSite();
  return (
    <a
      className="source"
      href={`https://github.com/banse/sworn/blob/${r.deployment.sourceCommit}/CATALOG.md#${part}`}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  );
}
export function CodeBlock({ children }: { children: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="code-block">
      <button
        className="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children);
            setStatus("Copied.");
          } catch {
            setStatus("Copy unavailable. Select and copy the code.");
          }
        }}
      >
        Copy
      </button>
      <pre tabIndex={0}>
        <code>{children}</code>
      </pre>
      <Status>{status || "Code scrolls sideways when needed."}</Status>
    </div>
  );
}
export function Card({
  facts,
  sample = false,
  miniId,
  interactive = false,
  onFamily,
}: {
  facts?: WalletFacts;
  sample?: boolean;
  miniId?: number;
  interactive?: boolean;
  onFamily?: (n: number) => void;
}) {
  return (
    <figure className={miniId ? "mini-card" : "card-figure"}>
      <div className="card-image">
        <img
          src={
            facts?.metadata.image ||
            asset(miniId ? `art/trait-${miniId}.svg` : "art/sample.svg")
          }
          alt={
            miniId
              ? ""
              : facts
                ? "Sworn hive showing the wallet’s thirteen fact families"
                : "Synthetic illustration of the thirteen-family Sworn hive"
          }
          width={miniId ? 56 : 650}
          height={miniId ? 56 : 650}
        />
        {interactive && (
          <div className="cell-controls" aria-label="Explore hive families">
            {HIVE_CELLS.map(({ family, x, y }) => (
              <button
                key={family}
                aria-label={`Inspect ${FAMILIES[family - 1]} cell`}
                style={{
                  left: `${(x - 89) / 10}%`,
                  top: `${(y - 77.1) / 10}%`,
                }}
                onClick={() => onFamily?.(family)}
              >
                <span>{family}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {!miniId && (
        <figcaption>
          {sample
            ? "Synthetic illustration · no wallet credential"
            : facts?.token === 0n
              ? "preview, no card minted"
              : facts
                ? `Sworn #${facts.token} · minted`
                : "Renderer illustration"}
        </figcaption>
      )}
    </figure>
  );
}
function SignedVerdict({ requestId }: { requestId: string }) {
  const { r, client, health } = useSite();
  const [result, setResult] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true);
    setStatus("Reading signed verdict from the selected RPC…");
    setResult(null);
    try {
      if (!health) throw Error("Live reads unavailable. Retry reads.");
      const found = await completion(client, r, health, requestId as any);
      if (!found)
        throw Error(
          "No completion was found through this RPC. Try another public RPC or retry later.",
        );
      setResult(found);
      setStatus(
        found.attestation
          ? "Signed verdict read from the Intake completion calldata."
          : "The completion has no successful signed verdict.",
      );
    } catch (e) {
      setStatus(explain(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signed-verdict">
      <button
        className="secondary"
        onClick={inspect}
        disabled={busy || !health}
      >
        {busy ? "Reading verdict…" : "Read signed verdict"}
      </button>
      <Status error={!!status && !result && !busy}>{status}</Status>
      {result && (
        <details open>
          <summary>Oracle completion and attestation</summary>
          <a
            className="source"
            href={`${r.deployment.network.explorer}/tx/${result.txHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Signed completion transaction ↗
          </a>
          <pre tabIndex={0}>
            {JSON.stringify(
              result,
              (_, v) => (typeof v === "bigint" ? v.toString() : v),
              2,
            )}
          </pre>
        </details>
      )}
    </div>
  );
}
export function WalletFactRows({
  facts,
  family,
}: {
  facts: WalletFacts;
  family?: number;
}) {
  const { health } = useSite();
  const rows = TRAITS.filter((t) => !family || t.family === family);
  return (
    <div className="fact-rows">
      {rows.map((t) => {
        const i = TRAITS.findIndex((row) => row.id === t.id);
        const result = facts.answers[i];
        const cannot =
          !facts.joined && ((t.id >= 701 && t.id <= 1105) || t.id === 1201);
        const pending = facts.pending[t.id];
        const proof = facts.verified[t.id];
        return (
          <div
            id={`trait-${t.id}`}
            className={`fact-row ${new URLSearchParams(location.hash.split("?")[1]).get("trait") === String(t.id) ? "highlight" : ""}`}
            key={t.id}
          >
            <div>
              <strong>
                {t.id} / {t.name}
              </strong>
              <Mark kind={t.class} rare={t.rare} />
            </div>
            <div className={result ? "accent" : "muted"}>
              {result
                ? "Proven"
                : t.class === "direct"
                  ? "Not present"
                  : cannot
                    ? "cannot be true: not in WhitelistCurator.sol"
                    : pending && !/^0x0+$/.test(pending)
                      ? "Request pending"
                      : "not claimed"}
            </div>
            <div className="rule">
              {t.rule} · {t.window}
            </div>
            {proof && !/^0x0+$/.test(proof[0]) && (
              <div className="proof">
                <SignedVerdict requestId={proof[0]} />
                <span>
                  Window {num(proof[2])} → {num(proof[3])}
                </span>
              </div>
            )}
            {!result && t.class !== "direct" && !cannot && (
              <div className="fact-request">
                <span className="muted">
                  {health
                    ? `${imd(health.price)} IMD · priceOf · live`
                    : "Live price unavailable"}
                </span>
                <a className="source" href={`#/claim?trait=${t.id}`}>
                  Request {t.name} ↗
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
