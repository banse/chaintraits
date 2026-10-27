// One small picture per fact of a hive cell, cut from Renderer SVGs: a built-in fact is its own cell on
// its trait card (public/art/trait-<id>.svg), a community fact is its ring on the wallet's card.
// Ring r (acceptance order) of a cell is the band between zone r-1 and zone r of a filled cell, the same
// band below the honey line plus its outline above it in a part-filled cell, or an outline in an empty one.
const BACKGROUND = "#0a0a0a"; // the card's background rect
const OFF = "#151515"; // the outline of an empty cell
const RING = "#05751f"; // ring outlines
const OUTLINE = "89.0,0.0 44.5,77.1 -44.5,77.1 -89.0,0.0 -44.5,-77.1 44.5,-77.1";

export function svgFromDataUri(uri) {
  if (typeof uri !== "string") return "";
  if (uri.startsWith("data:image/svg+xml;base64,"))
    return new TextDecoder().decode(
      Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) => c.charCodeAt(0)),
    );
  if (uri.startsWith("data:image/svg+xml,"))
    return decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
  return "";
}

// Start and end of the inner markup of the cell centred at (x, y), nested groups included; null when absent.
function cellRange(svg, x, y) {
  const open = `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">`;
  const start = svg.indexOf(open);
  if (start < 0) return null;
  let depth = 1;
  let at = start + open.length;
  while (depth) {
    const next = svg.indexOf("<g", at);
    const close = svg.indexOf("</g>", at);
    if (close < 0) return null;
    if (next >= 0 && next < close) {
      depth++;
      at = next + 2;
    } else {
      depth--;
      at = close + 4;
    }
  }
  return [start + open.length, at - 4];
}

/** Inner markup of the cell centred at (x, y), nested groups included; "" when the SVG has no such cell. */
export function cellMarkup(svg, x, y) {
  const range = cellRange(svg, x, y);
  return range ? svg.slice(...range) : "";
}

// Zone radii and opacities of a filled cell with k community rings (Renderer `_zones` / `_opacity`).
const ZONES = {
  77: "77.0,0.0 38.5,66.7 -38.5,66.7 -77.0,0.0 -38.5,-66.7 38.5,-66.7",
  62: "62.0,0.0 31.0,53.7 -31.0,53.7 -62.0,0.0 -31.0,-53.7 31.0,-53.7",
  45: "45.0,0.0 22.5,39.0 -22.5,39.0 -45.0,0.0 -22.5,-39.0 22.5,-39.0",
  28: "28.0,0.0 14.0,24.2 -14.0,24.2 -28.0,0.0 -14.0,-24.2 14.0,-24.2",
};
const OPACITIES = [["1.00"], ["0.35", "1.00"], ["0.35", "0.68", "1.00"], ["0.35", "0.57", "0.78", "1.00"]];
const EMPTY = `<polygon points="${OUTLINE}" fill="none" stroke="${OFF}" stroke-width="4" stroke-linejoin="round"/>`;

/** A fully filled cell (from its top tier's trait card) with its k community rings added as zones. */
export function withRings(filledCell, k) {
  const zone = filledCell.match(new RegExp(`<polygon points="${ZONES[77]}" fill="(#[0-9a-f]{6})" fill-opacity="1\\.00"/>`));
  if (!zone || !(k >= 1)) return filledCell;
  const zones = [77, 62, 45, 28]
    .slice(0, Math.min(k, 3) + 1)
    .map((r, z) => `<polygon points="${ZONES[r]}" fill="${zone[1]}" fill-opacity="${OPACITIES[Math.min(k, 3)][z]}"/>`)
    .join("");
  return filledCell.replace(zone[0], zones);
}

/** A card assembled cell by cell on `baseSvg` (any Renderer card): `cells` maps "x,y" to inner markup, others empty. */
export function composeCard(baseSvg, layout, cells) {
  let svg = baseSvg;
  for (const { x, y } of [...layout].reverse()) {
    const range = cellRange(svg, x, y);
    if (!range) return "";
    svg = svg.slice(0, range[0]) + (cells[`${x},${y}`] ?? EMPTY) + svg.slice(range[1]);
  }
  return svg;
}

const attributes = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const polygons = (markup) =>
  [...markup.matchAll(/<polygon\b[^>]*\/>/g)].map((m) => ({ tag: m[0], ...attributes(m[0]) }));
const group = (markup, prefix) =>
  markup.match(new RegExp(`<g clip-path="url\\(#(${prefix}\\d+)\\)">([\\s\\S]*?)</g>`));

/** `colour` at `opacity` over `base`, as the card composites a zone. */
export function mix(colour, opacity, base) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [rgb(colour), rgb(base)];
  return `#${a.map((v, i) => Math.round(v * opacity + b[i] * (1 - opacity)).toString(16).padStart(2, "0")).join("")}`;
}

export function picture(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-92 -92 184 184">${inner}</svg>`;
}

/** A built-in fact: its filled cell on its own trait card. */
export function builtInPicture(traitSvg, x, y) {
  const cell = cellMarkup(traitSvg, x, y);
  return cell ? picture(cell) : null;
}

/** A community fact: ring `ring` (1-based) of the cell on the wallet's card, inside an empty outline. */
export function ringPicture(cardSvg, x, y, ring) {
  const cell = cellMarkup(cardSvg, x, y);
  if (!cell || !(ring >= 1)) return null;
  const honey = group(cell, "h");
  const above = group(cell, "a");
  const zones = polygons(honey ? honey[2] : cell).filter((p) => p["fill-opacity"] !== undefined);
  const outlines = polygons(above ? above[2] : cell).filter((p) => p.fill === "none" && p.stroke === RING);
  let body = "";
  if (zones.length > ring) {
    let colour = BACKGROUND;
    for (let z = 0; z < ring; z++) colour = mix(zones[z].fill, Number(zones[z]["fill-opacity"]), colour);
    const band = `<path d="M${zones[ring - 1].points}Z M${zones[ring].points}Z" fill="${colour}" fill-rule="evenodd"/>`;
    body = honey
      ? `${cell.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? ""}<g clip-path="url(#${honey[1]})">${band}</g>`
      : band;
  }
  const outline = outlines[ring - 1];
  if (outline) body += above ? `<g clip-path="url(#${above[1]})">${outline.tag}</g>` : outline.tag;
  if (!body) return null;
  return picture(
    `<polygon points="${OUTLINE}" fill="none" stroke="${OFF}" stroke-width="4" stroke-linejoin="round"/>${body}`,
  );
}

/** The facts of the selected cells in table order: built-in facts by id, community facts with their ring. */
export function cellFacts(rows, families, positions) {
  return rows
    .filter((row) => families.includes(row.family))
    .map((row) => ({
      id: row.id,
      family: row.family,
      ring: positions.find((position) => position.id === row.id)?.ring ?? null,
    }));
}

/** A preview card on `sampleSvg` (the Renderer's card of all 25 built-in facts, so its cells are each family's top
 *  cell): the selected families keep their cell with `rings[family]` community rings, the others are empty. */
export function previewCard(sampleSvg, layout, families, rings) {
  const cells = {};
  for (const { family, x, y } of layout) {
    if (!families.includes(family)) continue;
    const cell = cellMarkup(sampleSvg, x, y);
    if (cell) cells[`${x},${y}`] = withRings(cell, rings[family] ?? 0);
  }
  return composeCard(sampleSvg, layout, cells);
}
