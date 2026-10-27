import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { asset, type WalletFacts } from "./chain";
import { TRAITS, FAMILIES } from "./data";
import { HIVE_CELLS } from "./hive-layout";
import { Card } from "./components";
import { CardFactGuide } from "./card-fact-guide";
import { walletSummaryRows } from "./wallet-summary-model.mjs";
import { communityDisplay } from "./card-facts.mjs";
import {
  builtInPicture,
  cellFacts,
  previewCard,
  ringPicture,
  svgFromDataUri,
} from "./cell-pictures.mjs";
import "./wallet-summary.css";

const CARD_FAMILIES = HIVE_CELLS.map((cell) => cell.family);

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
  const rows = walletSummaryRows(facts, TRAITS, specs, CARD_FAMILIES);
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
  const selected = selectedFamily ? [selectedFamily] : [];
  const symbols = useCellPictures(
    svgFromDataUri(facts.metadata.image),
    cellFacts(
      rows,
      selected,
      communityDisplay(facts.verifiedSpecs, CARD_FAMILIES).positions,
    ),
  );

  return (
    <div className="wallet-facts-summary">
      <h2 id={headingId}>Wallet Facts</h2>
      <p className="wallet-summary-address">
        <code>{facts.address}</code>
      </p>
      <div className="wallet-summary">
        <div className="wallet-summary-copy">
          {!rows.length ? (
            <p className="muted">No minted wallet facts yet.</p>
          ) : (
            <FactsTable
              label="Minted wallet facts"
              rows={rows}
              selected={selected}
              symbols={symbols}
            />
          )}
          <CardFactGuide ids={facts.verifiedSpecs} onFamily={toggleFamily} />
        </div>
        <div className="wallet-summary-art">
          <Card
            facts={facts}
            interactive
            availableFamilies={availableFamilies}
            activeFamily={selectedFamily ?? 0}
            onFamily={toggleFamily}
          />
          {rows.length > 0 && (
            <p className="wallet-summary-selection muted" role="status">
              {selectedFamily
                ? `${FAMILIES[selectedFamily - 1]} facts highlighted. Select the cell again to clear.`
                : "Select a filled hive cell to highlight its facts here."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Every built-in and registered community fact on an empty card; each selected cell adds its facts to the preview. */
export function WalletPreview({ specs }: { specs: any[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [sample, setSample] = useState("");
  useEffect(() => {
    let live = true;
    void art("sample").then((svg) => live && setSample(svg));
    return () => {
      live = false;
    };
  }, []);
  const community = specs.map((spec) => Number(spec.id));
  const rows = walletSummaryRows(
    {
      token: 1n,
      traits: TRAITS.map((trait) => trait.id),
      verifiedSpecs: community,
    },
    TRAITS,
    specs,
    CARD_FAMILIES,
  );
  const positions = communityDisplay(community, CARD_FAMILIES).positions;
  const rings: Record<number, number> = {};
  for (const { family } of positions)
    if (family !== null) rings[family] = (rings[family] ?? 0) + 1;
  const card = sample ? previewCard(sample, HIVE_CELLS, selected, rings) : "";
  const symbols = useCellPictures(card, cellFacts(rows, selected, positions));
  const toggle = (family: number) =>
    setSelected((old) =>
      old.includes(family)
        ? old.filter((value) => value !== family)
        : [...old, family],
    );
  // Side by side, the list continues below the card where that balances the two columns.
  const grid = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [split, setSplit] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!grid.current) return;
    const best = balancedSplit(grid.current, rows.length);
    if (best !== split) setSplit(best);
  }, [width, rows.length, !!card, split]);
  const left = rows.slice(0, split);
  const below = rows.slice(split);

  return (
    <div className="wallet-preview">
      <h2>Wallet Preview</h2>
      <p className="muted">
        Not a wallet: every fact that exists today. Select hive cells to see how
        their facts appear on a card; each cell you select adds to the preview.
      </p>
      <div className="wallet-summary" ref={grid}>
        <div className="wallet-summary-copy">
          <FactsTable
            label="All facts"
            rows={left}
            selected={selected}
            symbols={symbols}
          />
        </div>
        <div className="wallet-summary-art">
          {card && (
            <Card
              image={`data:image/svg+xml,${encodeURIComponent(card)}`}
              interactive
              activeFamilies={selected}
              onFamily={toggle}
              showCaption={false}
            />
          )}
          <p className="wallet-summary-selection muted" role="status">
            {selected.length
              ? `${selected.length} of ${CARD_FAMILIES.length} cells selected. Select a cell again to remove it.`
              : "Select a hive cell to add its facts to the preview."}
          </p>
          {below.length > 0 && (
            <FactsTable
              label="All facts, continued"
              rows={below}
              selected={selected}
              symbols={symbols}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Rows that stay beside the card in a two-column grid so that neither column is longer than needed; all of them
 *  in one column. Row heights do not depend on the split: both columns are equally wide. */
function balancedSplit(grid: HTMLElement, count: number) {
  if (getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length < 2)
    return Number.POSITIVE_INFINITY;
  const rows = [...grid.querySelectorAll<HTMLElement>("tbody tr")];
  if (rows.length !== count) return Number.POSITIVE_INFINITY;
  const height = (element: Element | null) =>
    element ? element.getBoundingClientRect().height : 0;
  const heights = rows.map(height);
  const head = height(grid.querySelector("thead"));
  const card =
    height(grid.querySelector(".card-figure")) +
    height(grid.querySelector(".wallet-summary-selection")) +
    16;
  const total = heights.reduce((sum, value) => sum + value, 0);
  let best = count;
  let bestHeight = Number.POSITIVE_INFINITY;
  let above = 0;
  for (let k = 0; k <= count; k++) {
    const columns = Math.max(
      head + above,
      k === count ? card : card + 24 + head + (total - above),
    );
    if (columns < bestHeight - 0.5) {
      bestHeight = columns;
      best = k;
    }
    above += heights[k] ?? 0;
  }
  return best;
}

function FactsTable({
  label,
  rows,
  selected,
  symbols,
}: {
  label: string;
  rows: { id: number; name: string; meaning: string; family: number | null }[];
  selected: number[];
  symbols: Record<number, string | null>;
}) {
  return (
    <table className="wallet-summary-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">Fact</th>
          <th scope="col">Rule</th>
          <th
            scope="col"
            className="wallet-summary-symbol"
            aria-label="Card symbol"
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const highlighted =
            row.family !== null && selected.includes(row.family);
          return (
            <tr
              key={row.id}
              data-fact-id={row.id}
              data-highlighted={highlighted}
              className={highlighted ? "is-highlighted" : undefined}
            >
              <th scope="row">
                {row.id} / {row.name}
              </th>
              <td>{row.meaning}</td>
              <td className="wallet-summary-symbol">
                {highlighted && symbols[row.id] ? (
                  <img
                    src={`data:image/svg+xml,${encodeURIComponent(symbols[row.id]!)}`}
                    alt={`${row.id} on the card`}
                    width={36}
                    height={36}
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const artCache = new Map<string, Promise<string>>();
const art = (name: string) => {
  if (!artCache.has(name))
    artCache.set(
      name,
      fetch(asset(`art/${name}.svg`))
        .then((response) => (response.ok ? response.text() : ""))
        .catch(() => ""),
    );
  return artCache.get(name)!;
};

/** Symbols by fact id: a built-in fact as its cell on its trait card, a community fact as its ring on `cardSvg`. */
function useCellPictures(
  cardSvg: string,
  items: { id: number; ring: number | null; family: number }[],
) {
  const [pictures, setPictures] = useState<Record<number, string | null>>({});
  const key = items
    .map((item) => `${item.id}:${item.ring}:${item.family}`)
    .join(",");
  useEffect(() => {
    let live = true;
    Promise.all(
      items.map(async (item) => {
        const cell = HIVE_CELLS.find((value) => value.family === item.family);
        if (!cell) return [item.id, null] as const;
        const svg =
          item.ring === null
            ? builtInPicture(await art(`trait-${item.id}`), cell.x, cell.y)
            : ringPicture(cardSvg, cell.x, cell.y, item.ring);
        return [item.id, svg] as const;
      }),
    ).then((entries) => {
      if (live) setPictures(Object.fromEntries(entries));
    });
    return () => {
      live = false;
    };
  }, [cardSvg, key]);
  return pictures;
}
