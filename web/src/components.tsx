import { HIVE_CELLS } from "./hive-layout";
import { useState, useRef, type ReactNode } from "react";
import { isAddress, getAddress } from "viem";
import { useSite } from "./context";
import { asset, explain, type WalletFacts } from "./chain";
import { completion } from "./settlement";
import { FAMILIES, TRAITS, FEE } from "./data";
import {
  IneligibleControl,
  MintedFact,
  ineligibleFact,
  useAttestedReader,
  useFactChecks,
} from "./fact-ui";
import { imd } from "./pure.mjs";
export const num = (n: bigint | number) => n.toLocaleString("en-US");
export function Section({
  title,
  id,
  children,
}: {
  title: ReactNode;
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
      href={`https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/blob/${r.deployment.sourceCommit}/CATALOG.md#${part}`}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  );
}
export function CommunityIntro() {
  return (
    <p className="prose">
      Anyone can define an immutable T1–T5 rule. Registration costs 6.4 IMD;{" "}
      {FEE}. Every request then costs the live oracle price per fact.
    </p>
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
  image,
  interactive = false,
  onFamily,
  activeFamily,
  availableFamilies,
  showCaption = true,
}: {
  facts?: Pick<WalletFacts, "token" | "metadata">;
  sample?: boolean;
  miniId?: number;
  image?: string;
  interactive?: boolean;
  onFamily?: (n: number) => void;
  activeFamily?: number;
  availableFamilies?: number[];
  showCaption?: boolean;
}) {
  return (
    <figure className={miniId ? "mini-card" : "card-figure"}>
      <div className="card-image">
        <img
          src={
            image ||
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
            {HIVE_CELLS.filter(
              ({ family }) =>
                !availableFamilies || availableFamilies.includes(family),
            ).map(({ family, x, y }) => (
              <button
                key={family}
                aria-label={`Inspect ${FAMILIES[family - 1]} cell`}
                aria-pressed={
                  activeFamily === undefined
                    ? undefined
                    : activeFamily === family
                }
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
      {!miniId && showCaption && (
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
export function CommunityCard({
  fact,
}: {
  fact: { id: number; name: string; rule: string; window: string };
}) {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char]!,
    );
  // Renderer geometry for an otherwise empty hive with one community fact:
  // the first community ring is in slot zero, independent of the spec's kind.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>${escape(`${fact.id} / ${fact.name}`)}</title><desc>${escape(`${fact.rule} · ${fact.window}`)}</desc><rect width="1000" height="1000" fill="#0a0a0a"/>${HIVE_CELLS.map(
    ({ x, y }, slot) =>
      `<g transform="translate(${x} ${y})"><polygon points="89,0 44.5,77.1 -44.5,77.1 -89,0 -44.5,-77.1 44.5,-77.1" fill="none" stroke="#151515" stroke-width="4" stroke-linejoin="round"/>${slot === 0 ? '<polygon points="62,0 31,53.7 -31,53.7 -62,0 -31,-53.7 31,-53.7" fill="none" stroke="#05751f" stroke-width="3"/>' : ""}</g>`,
  ).join("")}</svg>`;
  return (
    <Card
      miniId={fact.id}
      image={`data:image/svg+xml,${encodeURIComponent(svg)}`}
    />
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
      if (!health) throw Error("Live reads unavailable; retrying.");
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
            <code>
              {JSON.stringify(
                result,
                (_, v) => (typeof v === "bigint" ? v.toString() : v),
                2,
              )}
            </code>
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
  const [showIneligible, setShowIneligible] = useState(false);
  const checks = useFactChecks(
    facts,
    TRAITS.map((t) => t.id),
  );
  const reader = useAttestedReader(facts.address);
  const rows = TRAITS.filter((t) => !family || t.family === family);
  const hiddenCount = rows.filter((t) =>
    ineligibleFact(facts, t.id, checks[t.id]),
  ).length;
  return (
    <div className="fact-rows">
      <IneligibleControl
        count={hiddenCount}
        shown={showIneligible}
        onChange={() => setShowIneligible((v) => !v)}
      />
      {rows
        .filter(
          (t) => showIneligible || !ineligibleFact(facts, t.id, checks[t.id]),
        )
        .map((t) => {
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
                {result ? (
                  <MintedFact facts={facts} id={t.id} reader={reader} />
                ) : t.class === "direct" ? (
                  "Not present"
                ) : cannot ? (
                  "cannot be true: not in WhitelistCurator.sol"
                ) : pending && !/^0x0+$/.test(pending) ? (
                  "Request pending"
                ) : (
                  "not claimed"
                )}
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
                  <a className="source" href={`#/mint?trait=${t.id}`}>
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
