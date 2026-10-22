export function claimAnchor(id: string) {
  const path = location.hash.slice(1).split("#")[0];
  const query = path.match(/^\/(?:mint|claim)(\?.*)$/)?.[1] || "";
  return `#/mint${query}#${id}`;
}
