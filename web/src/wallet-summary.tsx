import { useEffect, useState } from "react";
import type { WalletFacts } from "./chain";
import { TRAITS, FAMILIES } from "./data";
import { HIVE_CELLS } from "./hive-layout";
import { Card } from "./components";
import { CardFactGuide } from "./card-fact-guide";
import { walletSummaryRows } from "./wallet-summary-model.mjs";
import "./wallet-summary.css";

/** Shares already-loaded wallet facts; selecting artwork never starts a read or scroll. */
export function WalletFactsSummary({
  facts,
  specs,
  headingId,
}: {
  facts: WalletFacts;
  specs: any[];
  headingId?: string;
}) {
  const [family, setFamily] = useState<number>();
  useEffect(() => setFamily(undefined), [facts.address]);
  const rows = walletSummaryRows(
    facts,
    TRAITS,
    specs,
    HIVE_CELLS.map((cell) => cell.family),
  );
  const availableFamilies = [
    ...new Set<number>(
      rows
        .map((row) => row.family)
        .filter((value): value is number => value !== null),
    ),
  ];
  const selectedFamily =
    family && availableFamilies.includes(family) ? family : undefined;
  const toggleFamily = (value: number) =>
    setFamily((old) => (old === value ? undefined : value));

  return (
    <div className="wallet-summary">
      <div className="wallet-summary-copy">
        <h2 id={headingId}>Wallet facts</h2>
        <p className="wallet-summary-address">
          <code>{facts.address}</code>
        </p>
        {!rows.length ? (
          <p className="muted">No minted wallet facts yet.</p>
        ) : (
          <table
            className="wallet-summary-table"
            aria-label="Minted wallet facts"
          >
            <thead>
              <tr>
                <th scope="col">Fact</th>
                <th scope="col">Rule</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-fact-id={row.id}
                  data-highlighted={selectedFamily === row.family}
                  className={
                    selectedFamily === row.family ? "is-highlighted" : undefined
                  }
                >
                  <th scope="row">
                    {row.id} / {row.name}
                  </th>
                  <td>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && (
          <p className="wallet-summary-selection muted" role="status">
            {selectedFamily
              ? `${FAMILIES[selectedFamily - 1]} facts highlighted. Select the cell again to clear.`
              : "Select a filled hive cell to highlight its facts here."}
          </p>
        )}
      </div>
      <div className="wallet-summary-art">
        <Card
          facts={facts}
          interactive
          availableFamilies={availableFamilies}
          activeFamily={selectedFamily ?? 0}
          onFamily={toggleFamily}
        />
        <CardFactGuide ids={facts.verifiedSpecs} onFamily={toggleFamily} />
      </div>
    </div>
  );
}
