export function claimAnchor(id: string) {
  const path = location.hash.slice(1).split("#")[0];
  const query = path.startsWith("/claim?") ? path.slice("/claim".length) : "";
  return `#/claim${query}#${id}`;
}
