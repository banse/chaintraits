// Synthetic rendering using the pinned Renderer's family order/count rules.
// No contract/EVM execution. This is deliberately labelled as local artwork.
export const CELLS = [
  [6, 500, 480],
  [1, 500, 313.7],
  [2, 644, 396.9],
  [3, 644, 563.1],
  [4, 500, 646.3],
  [5, 356, 563.1],
  [7, 356, 396.9],
  [8, 644, 230.6],
  [9, 788, 480],
  [10, 644, 729.4],
  [11, 356, 729.4],
  [12, 212, 480],
  [13, 356, 230.6],
];
export const NAMES = {
  101: "Spawned",
  201: "Zero-Shot",
  202: "Zero-Shot",
  301: "Hopper",
  302: "Hopper",
  303: "Hopper",
  401: "Bullfrog",
  402: "Bullfrog",
  403: "Bullfrog",
  404: "Bullfrog",
  501: "Benchmarked",
  502: "Benchmarked",
  503: "Benchmarked",
  601: "Swarmed",
  701: "Uptime",
  801: "Holdout",
  901: "Final Token",
  1001: "Hotfix",
  1101: "PID",
  1102: "PID",
  1103: "PID",
  1104: "PID",
  1105: "PID",
  1201: "Top Weights",
  1301: "Pretrained",
};
export const FAMILY_NAMES = [
  "Spawned",
  "Zero-Shot",
  "Hopper",
  "Bullfrog",
  "Benchmarked",
  "Swarmed",
  "Uptime",
  "Holdout",
  "Final Token",
  "Hotfix",
  "PID",
  "Top Weights",
  "Pretrained",
];
const hex = (radius) =>
  Array.from(
    { length: 6 },
    (_, i) =>
      `${+(radius * Math.cos((i * Math.PI) / 3)).toFixed(2)},${+(radius * Math.sin((i * Math.PI) / 3)).toFixed(2)}`,
  ).join(" ");
export function communityStep(count) {
  if (count < 40) return 0;
  if (count >= 8192) return 64;
  return (BigInt(count) ** 8n).toString(2).length - 41;
}
export function cardMetadata(row, specs = {}) {
  const traits = [
    ...new Set([
      ...row.directFacts,
      ...row.verifiedFacts.filter((id) => id < 10001),
    ]),
  ].sort((a, b) => a - b);
  const community = [...new Set(row.verifiedFacts.filter((id) => id >= 10001))],
    count = community.length,
    display = community.slice(0, 32);
  const tops = Array(13).fill(0);
  for (const id of traits) {
    const f = Math.floor(id / 100);
    if (f < 1 || f > 13) continue;
    if (!tops[f - 1] || (f === 11 ? id < tops[f - 1] : id > tops[f - 1]))
      tops[f - 1] = id;
  }
  const step = communityStep(count);
  const cells = CELLS.map(([family, x, y], slot) => {
    const id = tops[family - 1],
      tiers =
        family === 2 ? 2 : [3, 5].includes(family) ? 3 : family === 4 ? 4 : 1,
      level = id ? (family === 11 ? 1 : Math.min(id % 100, tiers)) : 0;
    const color =
      family <= 5
        ? "#00cc33"
        : [6, 13].includes(family)
          ? "#8ff0a4"
          : family === 12
            ? "#dbfee6"
            : "#00ff41";
    const rings = [0, 1, 2].filter((d) => 13 * d + slot < count);
    const rare = [202, 801, 901, 1001, 1101, 1102, 1103, 1104, 1201].includes(
      id,
    );
    return `<g data-family="${family}" data-top="${id}" transform="translate(${x} ${y})"><polygon points="${hex(89)}" fill="${level ? color : "#0a0a0a"}" fill-opacity="${level ? 0.12 + (0.2 * level) / tiers : 1}" stroke="${level ? color : "#333"}" stroke-width="4"/>${level && level < tiers ? `<text x="0" y="30" fill="${color}" text-anchor="middle" font-family="monospace" font-size="20">${level}/${tiers}</text>` : ""}${rings.map((d) => `<polygon data-community-ring="${13 * d + slot + 1}" points="${hex(62 - d * 16)}" fill="none" stroke="#05751f" stroke-width="4"/>`).join("")}${rare ? '<circle r="11" fill="#fff"/>' : ""}</g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>Sworn local mock wallet facts</title><rect width="1000" height="1000" fill="#090909"/><text x="500" y="105" text-anchor="middle" fill="#ddd" font-family="monospace" font-size="32">SWORN · LOCAL MOCK</text>${cells}${step ? `<rect data-community-frame-step="${step}" x="100" y="150" width="800" height="665" rx="36" fill="none" stroke="#05751f" stroke-width="5" pathLength="64" stroke-dasharray="${step} 64"/>` : ""}<text x="500" y="878" text-anchor="middle" fill="#ddd" font-family="monospace" font-size="25">${count} accepted community ${count === 1 ? "fact" : "facts"}</text><text x="500" y="925" text-anchor="middle" fill="#aaa" font-family="monospace" font-size="22">Synthetic artwork · not a credential</text></svg>`;
  return {
    name:
      row.tokenId === "0"
        ? "Local mock Sworn preview"
        : `Local mock Sworn #${row.tokenId}`,
    description:
      "Synthetic local illustration. Not deployed Renderer output or a wallet credential.",
    image: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    attributes: [
      { trait_type: "Claimant", value: row.address },
      ...tops.map((id, i) => ({
        trait_type: FAMILY_NAMES[i],
        value: id ? String(id) : "none",
      })),
      { trait_type: "community_count", value: count },
      ...display.map((id) => ({
        trait_type: `Community ${id}`,
        value: specs[id]?.name || `Fact ${id}`,
      })),
    ],
    traits,
    verifiedSpecs: display,
    community: display,
    communityCount: count,
    display: {
      communityMetadataLimit: 32,
      communityRings: Math.min(39, count),
      communityFrameStep: step,
    },
    environment: "LOCAL MOCK",
  };
}
export const metadataUri = (row, specs) =>
  "data:application/json;base64," +
  Buffer.from(JSON.stringify(cardMetadata(row, specs))).toString("base64");
