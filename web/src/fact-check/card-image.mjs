// The Fact Check card as one 1600×1000 image to download or share: the title, the fact column, the artwork the
// card shows (inner markup of a 1000×1000 SVG box), the wallet column with its result mark, and the saved labels.
export const CARD_IMAGE = { width: 1600, height: 1000 };
const FONT = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const escapeXml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/** Lines of at most `width` characters (the font is monospace); a word longer than a line is cut. */
export function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    for (let rest = word; rest; ) {
      const room = line ? width - line.length - 1 : width;
      if (rest.length <= room) {
        line = line ? `${line} ${rest}` : rest;
        rest = "";
      } else if (line) {
        lines.push(line);
        line = "";
      } else {
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

const text = (x, y, size, fill, value, extra = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle"${extra}>${escapeXml(value)}</text>`;

export function cardImageSvg({ title, label, question, factName, wallet, ensName, saved, result, footer, art, colours }) {
  const c = { bg: "#0a0a0a", text: "#d9e0da", muted: "#8c968e", accent: "#00ff41", danger: "#ff7777", ...colours };
  const negative = result === "negative";
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_IMAGE.width}" height="${CARD_IMAGE.height}" viewBox="0 0 ${CARD_IMAGE.width} ${CARD_IMAGE.height}" font-family="${FONT}">`,
    `<rect width="${CARD_IMAGE.width}" height="${CARD_IMAGE.height}" fill="${c.bg}"/>`,
    text(800, 100, 40, c.muted, title, ' font-weight="700" letter-spacing="3"'),
  ];
  let y = 300;
  if (label) out.push(text(270, y, 22, c.accent, label, ' font-weight="700"'));
  y += 50;
  for (const line of wrap(question, 26).slice(0, 7)) {
    out.push(text(270, y, 24, c.muted, line));
    y += 40;
  }
  y += 60;
  for (const line of wrap(String(factName).toUpperCase(), 16).slice(0, 3)) {
    out.push(text(270, y, 38, c.muted, line, ' font-weight="700"'));
    y += 52;
  }
  if (art) out.push(`<svg x="500" y="150" width="600" height="600" viewBox="0 0 1000 1000">${art}</svg>`);
  out.push(text(1330, 300, 22, c.accent, "WALLET", ' font-weight="700"'));
  const address = String(wallet || "Wallet not reported");
  [address.slice(0, 21), address.slice(21)].filter(Boolean).forEach((line, i) => out.push(text(1330, 350 + i * 40, 24, c.muted, line)));
  if (ensName) out.push(text(1330, 450, 26, c.text, ensName));
  if (result) {
    const mark = negative ? c.danger : c.accent;
    out.push(
      `<circle cx="1330" cy="620" r="72" fill="${negative ? "#170e0e" : "#0d140d"}" stroke="${mark}" stroke-width="4"/>`,
      text(1330, 654, 96, mark, negative ? "×" : "✓", ' font-weight="600"'),
    );
  }
  (saved || []).forEach((line, i) => out.push(text(800, 830 + i * 46, 26, negative ? c.danger : c.accent, line, ' font-weight="700" letter-spacing="1"')));
  if (footer) out.push(text(800, 950, 18, c.muted, footer));
  out.push("</svg>");
  return out.join("");
}
