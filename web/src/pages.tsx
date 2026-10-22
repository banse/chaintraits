import { useState, useEffect } from "react";
import { isAddress, getAddress, type Address } from "viem";
import { useSite } from "./context";
import { asset, lookup, read, explain, type WalletFacts } from "./chain";
import {
  HEADLINE,
  DESCRIPTION,
  WHY,
  BUILT,
  NOCOIN,
  OWNERLESS,
  FEE,
  TRAITS,
  classes,
  WINDOWS,
  SWARMED,
} from "./data";
import {
  AddressForm,
  Card,
  ContractList,
  Section,
  Mark,
  Status,
  Sources,
  CodeBlock,
  WalletFactRows,
  num,
} from "./components";
import { imd, exactUnits } from "./pure.mjs";
import { Settlement } from "./claim";
import { useTransactions, TransactionJournal } from "./transactions";
function IntroDescription() {
  const [a, b] = DESCRIPTION.split("IMD agents");
  return (
    <p className="prose">
      {a}
      <a href="https://imd.fun/docs" target="_blank" rel="noreferrer">
        IMD agents
      </a>
      {b}
    </p>
  );
}
function Why() {
  return (
    <>
      <p className="prose">{WHY}</p>
      <blockquote>
        “Because the list lives onchain, a gating contract can read it directly
        at mint time: there is no merkle root to publish and no snapshot to
        maintain.”
      </blockquote>
      <a className="source" href="#/whitelistcurator#source">
        WhitelistCurator.sol · for builders ↗
      </a>
    </>
  );
}
function Built() {
  const { r } = useSite();
  return (
    <>
      <p className="prose">{BUILT}</p>
      <div className="inline-links">
        <a
          href={`https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/tree/${r.deployment.sourceCommit}/audits`}
          target="_blank"
          rel="noreferrer"
        >
          Public build and audit records ↗
        </a>
        <a
          href={`${r.deployment.network.explorer}/address/${r.deployment.contracts[0].address}`}
          target="_blank"
          rel="noreferrer"
        >
          Live deployment ↗
        </a>
      </div>
    </>
  );
}
export function Home() {
  const { health } = useSite();
  return (
    <>
      <section className="landing">
        <div className="landing-copy">
          <h1>{HEADLINE}</h1>
          <AddressForm />
          <IntroDescription />
          <div className="inline-links">
            <a href="#/claim">Mint your card ↗</a>
            <a href="#/catalog">Read the 25 facts ↗</a>
          </div>
        </div>
        <div className="landing-art">
          <Card sample />
          <p className="art-note">13 families. One wallet’s record.</p>
        </div>
      </section>
      <div className="record-strip">
        <div>
          <strong>19,522</strong>
          <span>recorded wallets</span>
        </div>
        <div>
          <strong>25</strong>
          <span>verifiable facts</span>
        </div>
        <div>
          <strong>66 hours</strong>
          <span>of WhitelistCurator</span>
        </div>
        <div>
          <strong>Ownerless</strong>
          <span>Ethereum mainnet</span>
        </div>
      </div>
      <Section title="Four kinds of evidence" id="evidence">
        <p className="prose">
          A green cell has a rule behind it. The class tells you where that fact
          comes from and how it was sworn by swarm.
        </p>
        <div className="class-grid">
          {classes.map((c, i) => (
            <article className="class-description" key={c.key}>
              <div className={`class-icon ${c.key}`} aria-hidden="true">
                {["◇", "⬡", "◈", "✳"][i]}
              </div>
              <h3>{c.name}</h3>
              <p>{c.description}</p>
              <a href={`#/catalog#${c.key}`}>Read {c.name.toLowerCase()} ↗</a>
            </article>
          ))}
        </div>
      </Section>
      <Section title="How it works">
        <div className="two-col">
          <article>
            <h3>For a wallet</h3>
            <ol className="story">
              <li>
                <strong>Mint a card</strong>
                <p>
                  Your direct facts are captured at mint.{" "}
                  <a href="#/claim#mint">Mint your card</a>.
                </p>
              </li>
              <li>
                <strong>Add traits</strong>
                <p>
                  Request evidence for a paid oracle fact.{" "}
                  <a href="#/claim#step-02">Add traits</a>.
                </p>
              </li>
              <li>
                <strong>Swear new facts</strong>
                <p>
                  Define an immutable community rule.{" "}
                  <a href="#/claim#step-03">Register a trait</a>.
                </p>
              </li>
            </ol>
          </article>
          <article>
            <h3>For a curator</h3>
            <ol className="story">
              <li>
                <strong>Find a signal</strong>
                <p>
                  A human looking for real wallets starts with a rule, an id and
                  its evidence.
                </p>
              </li>
              <li>
                <strong>Read the fact</strong>
                <p>
                  Gate a mint, grant or allowlist directly.{" "}
                  <a href="#/integrate">Read hasTrait</a>.
                </p>
              </li>
              <li>
                <strong>Check the claimant</strong>
                <p>
                  The fact follows the wallet that earned it. The card is a
                  transferable artifact.
                </p>
              </li>
            </ol>
          </article>
        </div>
      </Section>
      <Section title="WHY SWORN">
        <Why />
      </Section>
      <Section title="BUILT BY THE SWARM">
        <Built />
      </Section>
      <p className="prose">{NOCOIN}</p>
    </>
  );
}
export function Catalog() {
  const { health, specs, specError, loading, error } = useSite();
  return (
    <>
      <h1>Catalog</h1>
      <p className="prose">
        25 facts, thirteen families. Every id names a rule any contract can
        check. A white dot marks a rare trait.
      </p>
      {classes.map((c) => (
        <Section key={c.key} title={c.name} id={c.key}>
          <p className="prose">
            {c.description} {c.how}
          </p>
          {c.key !== "direct" && (
            <div className="cost-line">
              {health
                ? `${imd(health.price)} IMD · priceOf · live`
                : "Cost: the live oracle price per fact"}{" "}
              · <a href="#/claim#step-02">Request a fact ↗</a>
            </div>
          )}
          <div className="catalog-table" role="table" aria-label={c.name}>
            <div className="catalog-head" role="row">
              <span role="columnheader">Fact</span>
              <span role="columnheader">Rule · window</span>
              <span role="columnheader">Evidence</span>
            </div>
            {TRAITS.filter((t) => t.class === c.key).map((t) => (
              <div className="catalog-row" role="row" key={t.id}>
                <div role="cell">
                  <strong>
                    {t.id} / {t.name}
                  </strong>
                </div>
                <div role="cell">
                  {t.rule}
                  <span className="rule">{t.window}</span>
                </div>
                <div role="cell">
                  <Mark kind={t.class} rare={t.rare} />
                </div>
              </div>
            ))}
          </div>
          <Sources
            part={
              c.key === "direct"
                ? "2-ids-and-tiers"
                : c.key === "chain"
                  ? "3-trait-table-25-slots-working-names"
                  : c.key === "shared"
                    ? "4-what-the-callback-accepts-per-class"
                    : "8-operational-limits"
            }
            label={`CATALOG · ${c.name}`}
          />
        </Section>
      ))}
      <Section title="Community facts" id="community">
        <p className="prose">
          Anyone can define an immutable T1–T5 rule. Registration costs 6.4 IMD;{" "}
          {FEE}. BurnExecutor V2 receives this fee. Every request then costs the
          live oracle price per fact.
        </p>
        {loading ? (
          <Status>Reading community specs…</Status>
        ) : error ? (
          <Status error>{error}</Status>
        ) : specError ? (
          <Status error>{specError}</Status>
        ) : !specs.length ? (
          <p className="muted">
            No community specs registered yet.{" "}
            <a href="#/claim#step-03">Register the first rule</a>.
          </p>
        ) : (
          <div className="fact-rows">
            {specs.map((s) => (
              <div className="fact-row" key={s.id}>
                <strong>
                  {s.id} / {s.name}
                </strong>
                <p>
                  T{s.kind} · threshold {s.threshold.toString()} ·{" "}
                  {num(s.fromBlock)} → {num(s.toBlock)}
                </p>
                <Mark
                  kind={
                    s.kind === 3 ? "shared" : s.kind >= 5 ? "panel" : "chain"
                  }
                />
                <a href={`#/claim?trait=${s.id}`}>Request this fact ↗</a>
              </div>
            ))}
          </div>
        )}
        <Sources
          part="5-spec-registration-community-traits"
          label="CATALOG · community registration"
        />
      </Section>
      <Section title="Four fixed block windows">
        <div className="window-grid">
          {WINDOWS.map(([name, a, b]) => (
            <div key={name}>
              <strong>{name}</strong>
              <span>
                {a} → {b}
              </span>
            </div>
          ))}
        </div>
        <p>{SWARMED}</p>
      </Section>
      <Section title="Limits of the record">
        <p className="prose">
          WhitelistCurator.sol records wallet behavior, not people. It is not
          sybil-resistant. An oracle attestation shows which agents agreed on a
          rule and a block window; it does not make the rule a measure of
          character. No verdict and a false answer grant no trait.
        </p>
        <p>
          Direct tiers are monotone. A card shows the highest level per family,
          except PID, which shows the lowest verified ordinal id.
        </p>
        <Sources part="6-fees-and-sharing" label="CATALOG · fees and sharing" />
      </Section>
    </>
  );
}
export function Explorer() {
  const site = useSite();
  const initial =
    new URLSearchParams(location.hash.split("?")[1]).get("address") || "";
  const [address, setAddress] = useState(initial);
  const [facts, setFacts] = useState<WalletFacts | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [family, setFamily] = useState<number>();
  const [tick, setTick] = useState(0);
  const journal = useTransactions();
  useEffect(() => {
    let active = true;
    setFacts((previous) =>
      previous?.address.toLowerCase() === address.toLowerCase()
        ? previous
        : null,
    );
    setError("");
    setBusy(false);
    if (!address) return;
    if (!isAddress(address, { strict: false })) {
      setError("Enter a valid Ethereum address.");
      return;
    }
    if (!site.health) {
      setFacts(null);
      if (site.error) setError(site.error);
      return;
    }
    setBusy(true);
    lookup(
      site.client,
      site.r,
      site.health,
      address as Address,
      TRAITS.map((t) => t.id),
    )
      .then((value) => {
        if (active) setFacts(value);
      })
      .catch((e) => {
        if (active) {
          setFacts(null);
          setError(explain(e));
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [address, site.health, tick]);
  const factsAddress = facts?.address;
  useEffect(() => {
    if (!factsAddress) return;
    const id = new URLSearchParams(location.hash.split("?")[1]).get("trait");
    if (id) {
      const timeout = setTimeout(
        () =>
          document
            .getElementById(`trait-${id}`)
            ?.scrollIntoView({ block: "start" }),
        50,
      );
      return () => clearTimeout(timeout);
    }
  }, [factsAddress]);
  return (
    <>
      <h1>Explorer</h1>
      <AddressForm
        initial={initial}
        onSubmit={(a) => {
          if (address === a) setTick((t) => t + 1);
          setAddress(a);
          history.replaceState(null, "", `#/explorer?address=${a}`);
        }}
      />
      <Status error={!!error}>
        {error ||
          (busy
            ? facts
              ? "Refreshing wallet facts…"
              : "Reading the Registry, Curator and deployed Renderer…"
            : facts
              ? "Wallet facts loaded."
              : !address
                ? "Enter any wallet to read its facts."
                : "")}
      </Status>
      {error && (
        <button
          onClick={() => {
            setTick((v) => v + 1);
            site.refresh();
          }}
        >
          Retry reads
        </button>
      )}
      {facts && site.health && (
        <>
          <div className="explorer-head">
            <div>
              <h2>Wallet facts</h2>
              <p className="break">{facts.address}</p>
              <p className="muted">
                Live reads at Ethereum block {num(site.health.block)}.
                Credentials use hasTrait and tokenOf, never ownerOf.
              </p>
              <dl className="wallet-metrics">
                <div>
                  <dt>WhitelistCurator</dt>
                  <dd>
                    {facts.joined
                      ? `Joined in hour ${num(facts.hour)}`
                      : "Not in the record"}
                  </dd>
                </div>
                <div>
                  <dt>Deposits</dt>
                  <dd>{num(facts.count)}</dd>
                </div>
                <div>
                  <dt>Largest single send</dt>
                  <dd>{exactUnits(facts.capital)} ETH</dd>
                </div>
                <div>
                  <dt>Points</dt>
                  <dd>{num(facts.points)}</dd>
                </div>
                <div>
                  <dt>Verified community specs</dt>
                  <dd>
                    {facts.verifiedSpecs.length
                      ? facts.verifiedSpecs.join(", ")
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Frozen direct snapshot</dt>
                  <dd>
                    {facts.frozen === null
                      ? "No card minted"
                      : facts.frozen.toString()}
                  </dd>
                </div>
              </dl>
              <p className="muted">
                Select a hive cell to inspect that family.
              </p>
              {family && (
                <button onClick={() => setFamily(undefined)}>
                  Show all 25 facts
                </button>
              )}
            </div>
            <Card
              facts={facts}
              interactive
              onFamily={(n) => {
                setFamily(n);
                setTimeout(
                  () =>
                    document
                      .getElementById("wallet-facts")
                      ?.scrollIntoView({ block: "start" }),
                  0,
                );
              }}
            />
          </div>
          <section id="wallet-facts" className="section">
            <h2>{family ? `Family ${family}` : "All 25 facts"}</h2>
            <WalletFactRows facts={facts} family={family} />
          </section>
          {Object.entries(facts.pending)
            .filter(([, rid]) => !/^0x0+$/.test(rid))
            .map(([id, rid]) => (
              <section key={id} className="section">
                <h2>{id} / Pending verdict</h2>
                <Settlement requestId={rid} journal={journal} />
              </section>
            ))}
          {Object.values(facts.pending).some((rid) => !/^0x0+$/.test(rid)) && (
            <TransactionJournal journal={journal} />
          )}
          <Section title="Community and raw metadata">
            <p>
              Community ids: {facts.verifiedSpecs.join(", ") || "none verified"}
              .
            </p>
            <details>
              <summary>Lossless raw tokenURI metadata</summary>
              <p>
                Integers below are the original Renderer text. They are never
                converted to floating-point values.
              </p>
              <pre tabIndex={0}>{facts.raw}</pre>
              <a
                download="sworn-metadata.json"
                href={`data:application/json;charset=utf-8,${encodeURIComponent(facts.raw)}`}
              >
                Download exact metadata
              </a>
            </details>
          </Section>
        </>
      )}
    </>
  );
}
export function FactArtifact() {
  return (
    <>
      <h1>Fact vs artifact</h1>
      <p className="prose">
        A fact is about a wallet. A card is a transferable view of that wallet’s
        record.
      </p>
      <div className="comparison">
        <article>
          <h2>The fact</h2>
          <p>
            A credential is the Registry’s <code>hasTrait(wallet, id)</code>. A
            card is not required. The wallet that proves an oracle fact is its
            claimant.
          </p>
        </article>
        <article>
          <h2>The artifact</h2>
          <p>
            A Sworn card is an ERC-721. It may be sold or transferred, but its
            facts stay about the original claimant. Direct facts are frozen at
            mint; only that claimant can add personal facts.
          </p>
        </article>
        <article>
          <h2>The attestation</h2>
          <p>
            A signed answer binds a request, question hash, rule, chain, panel
            and block window. A chain-proven fact has a reproducible recipe. A
            panel-sworn fact records a quorum’s judgment, with the risk of a
            mistaken verdict.
          </p>
        </article>
      </div>
      <Section title="How to verify a card">
        <ol className="story">
          <li>
            Read <code>claimantOf(tokenId)</code> on the authentic Registry.
          </li>
          <li>
            Read <code>hasTrait(claimant, traitId)</code> for every fact you
            rely on.
          </li>
          <li>
            Read <code>verified(claimant, traitId)</code> for the request and
            pinned window.
          </li>
          <li>
            Check the attestation against the fixed attester and panel rules.
          </li>
        </ol>
        <p>
          Never substitute <code>ownerOf</code> for claimant credentials. A
          Renderer accepts a registry supplied by its caller, so an image alone
          proves nothing.
        </p>
        <div className="inline-links">
          <a href="#/integrate">Copy verification calls ↗</a>
          <a href="https://github.com/identity-md-launches/launch-2404-renderer-composer-registry/blob/c4ff3238390fc51962fb67e86affc20cf418126e/README.md">
            Read the contract README ↗
          </a>
          <a href="./agents/sworn.md" download>
            Agent verification skill ↗
          </a>
        </div>
      </Section>
    </>
  );
}
export function Integrate() {
  const { r, health, error } = useSite();
  const registry = r.deployment.contracts.find((c) => c.name === "Registry")!;
  const solidity = `// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n\ninterface ISworn {\n    function hasTrait(address wallet, uint16 id)\n        external view returns (bool);\n}\n\ncontract SwornGate {\n    ISworn constant sworn = ISworn(${getAddress(registry.address)});\n    function eligible(address wallet) external view returns (bool) {\n        return sworn.hasTrait(wallet, 101);\n    }\n}`;
  const cast = `REGISTRY=${registry.address}\n# Set WALLET to the claimant you are verifying.\ncast call "$REGISTRY" 'hasTrait(address,uint16)(bool)' "$WALLET" 101 --rpc-url ${r.deployment.network.rpcUrls[0]}\ncast call "$REGISTRY" 'tokenOf(address)(uint256)' "$WALLET" --rpc-url ${r.deployment.network.rpcUrls[0]}`;
  return (
    <>
      <h1>Integrate</h1>
      <p className="prose">
        Use a fact directly in your contract. No indexer, snapshot or card
        ownership check is needed. Ids are family × 100 + tier; community specs
        begin at 10001.
      </p>
      <Section title="Gate with hasTrait">
        <CodeBlock>{solidity}</CodeBlock>
      </Section>
      <Section title="Read with cast">
        <CodeBlock>{cast}</CodeBlock>
      </Section>
      <Section title="Verify the deployment">
        <ContractList />
        <p>
          Source commit:{" "}
          <span className="break">{r.deployment.sourceCommit}</span>
        </p>
        <p>
          ABI integrity is checked when the app starts. Contract runtimes are
          checked against the pinned compilation before writes.
        </p>
        {health ? (
          <dl className="contracts">
            {Object.entries(health.deps).map(([name, value]) => (
              <div key={name}>
                <dt>{name}()</dt>
                <dd>
                  <a href={`${r.deployment.network.explorer}/address/${value}`}>
                    {value}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <Status error={!!error}>
            {error || "Reading the seven Registry getters…"}
          </Status>
        )}
        <div className="inline-links">
          {r.deployment.contracts.map((c) => (
            <a key={c.name} href={asset(c.abiPath)} download>
              {c.name} ABI ↓
            </a>
          ))}
        </div>
      </Section>
      <Section title="For coding agents">
        <p>
          Read the verification skill as Markdown: facts, artifact rules, all 25
          ids and reproducible mainnet calls.
        </p>
        <a href={asset("agents/sworn.md")}>Read sworn.md ↗</a>
      </Section>
    </>
  );
}
export function WhitelistCurator() {
  const [data, setData] = useState<any>();
  const [source, setSource] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      fetch(asset("data/hours.json")).then((r) => r.json()),
      fetch(asset("data/curator-source.json")).then((r) => r.json()),
    ])
      .then(([d, s]) => {
        setData(d);
        setSource(s);
      })
      .catch((e) => setError(explain(e)));
  }, []);
  return (
    <>
      <h1>WhitelistCurator</h1>
      <p className="prose">
        A 66-hour onchain game became a permanent wallet record. Every deposit
        sent its ETH straight back; the history is what remains.
      </p>
      <div className="bands">
        {[
          ["Hours 0–23", "22,395", "15,620", "114,291"],
          ["Hours 24–45", "5,073", "3,095", "12,846"],
          ["Hours 46–65", "885", "807", "994"],
        ].map(([title, d, c, e]) => (
          <div key={title}>
            <h2>{title}</h2>
            <dl>
              <div>
                <dt>Deposits</dt>
                <dd>{d}</dd>
              </div>
              <div>
                <dt>New contributors</dt>
                <dd>{c}</dd>
              </div>
              <div>
                <dt>ETH sent and returned</dt>
                <dd>{e}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      <Section title="The hour-24 cliff">
        <p className="prose">
          The grace period ended after hour 23. From hour 24, an unsaved hour
          could end the game. Activity fell sharply. Hour 65 held the last
          deposit: one wallet, one final transaction.
        </p>
        <p>
          28,353 deposits · 19,522 wallets · 128,131 ETH sent and returned. ETH
          totals are rounded to whole ETH; they sum the event’s amount, not
          credited weight.
        </p>
      </Section>
      {error && <Status error>{error}</Status>}
      {data && (
        <Section title="Every hour" id="hours">
          <div className="hour-chart" aria-label="Deposits per hour">
            <div className="chart-bars">
              {data.hours.map((h: any) => (
                <div
                  key={h.hour}
                  style={{
                    height: `${Math.max(1, (h.deposits / Math.max(...data.hours.map((r: any) => r.deposits))) * 100)}%`,
                  }}
                  title={`Hour ${h.hour}: ${num(h.deposits)} deposits`}
                />
              ))}
            </div>
            <div className="chart-axis">
              <span>Hour 0</span>
              <span>24 · grace period ends</span>
              <span>65 · last deposit</span>
            </div>
          </div>
          <p className="muted">
            This 66-hour table can scroll sideways on a phone. ETH appears
            before first deposits.
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="66-hour census table"
          >
            <table>
              <thead>
                <tr>
                  <th>Hour</th>
                  <th>Deposits</th>
                  <th>ETH</th>
                  <th>First deposits</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.map((h: any) => (
                  <tr key={h.hour}>
                    <td>{h.hour}</td>
                    <td>{num(h.deposits)}</td>
                    <td>
                      {num(
                        (BigInt(h.wei) + 500000000000000000n) /
                          1000000000000000000n,
                      )}
                    </td>
                    <td>{num(h.firstDeposits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="source">
            Window: {num(data.fromBlock)} → {num(data.toBlock)} · method:
            eth_getLogs census
          </p>
          <a className="source" href={asset("data/hours.json")}>
            Download census and provenance ↗
          </a>
        </Section>
      )}
      {source && (
        <Section title="WhitelistCurator.sol" id="source">
          <p className="prose">
            The verified contract’s original message, lines 4–62. The record was
            designed for builders to read at mint time.
          </p>
          <div className="source-lines">
            {source.lines.map((line: any) => (
              <div key={line.line}>
                <span className="line-number" aria-hidden="true">
                  {line.line}
                </span>
                <code>{line.text}</code>
              </div>
            ))}
          </div>
          <a className="source" href={source.url}>
            Verified source ↗
          </a>
          <p className="muted break">Source SHA-256: {source.sourceSha256}</p>
        </Section>
      )}
    </>
  );
}
export function About() {
  const { r, health } = useSite();
  return (
    <>
      <h1>About Sworn</h1>
      <Section title="WHY SWORN">
        <Why />
      </Section>
      <Section title="Ownerless">
        <p className="prose">{OWNERLESS}</p>
        <p className="prose">{NOCOIN}</p>
        <p>
          A card is named Sworn, symbol SWORN. Supply is uncapped, with one mint
          per wallet.{" "}
          {health
            ? `The live registry currently has ${num(health.supply)} minted cards.`
            : "Live supply is unavailable until the deployment check finishes."}
        </p>
        <p>
          For minting and registration, {FEE}. BurnExecutor V2 receives fees;
          its bridge configuration, message delivery and Base execution are
          external dependencies.
        </p>
      </Section>
      <Section title="BUILT BY THE SWARM">
        <Built />
      </Section>
      <Section title="The record and its lore">
        <p className="prose">
          WhitelistCurator.sol was a game of escalating contributions. It
          recorded the largest single send, deposit count, first hour and score.
          After the first day, wallets had to keep saving hours to keep it
          alive. The last deposit came in hour 65. Sworn makes that settled
          history readable as credentials.
        </p>
        <a href="#/whitelistcurator">Read the 66-hour record ↗</a>
      </Section>
      <Section title="Contracts">
        <ContractList />
        <p>
          Chain: {r.deployment.network.name} · {r.deployment.chainId}
        </p>
        <p className="break">Attested source: {r.deployment.sourceCommit}</p>
        <p>
          Three earlier deployments (Registry 0x39bec764…95a6, swarm launch
          #2147, 2026-10-18; Registry 0xdd0017e4…5edb, swarm launch #2341,
          2026-10-20; Registry 0x9cb36ecc…a828, swarm launch #2362, 2026-10-21)
          were tests, never announced; this registry replaced them on
          2026-10-21.
        </p>
      </Section>
      <div className="inline-links">
        <a href="https://github.com/identity-md-launches/launch-2404-renderer-composer-registry">
          Source repository ↗
        </a>
        <a href="https://imd.fun">Identity.md ↗</a>
        <a href="https://imd.fun/docs">IMD agents ↗</a>
        <a href="https://x.com/swornbyswarm">Sworn on X ↗</a>
      </div>
    </>
  );
}
