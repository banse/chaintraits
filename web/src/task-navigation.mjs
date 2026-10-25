export const TASKS = [
  ["/mint", "Mint Card"],
  ["/request", "Mint Facts"],
  ["/register", "Mint Rule"],
];

// Keep old bookmarks meaningful when the combined Mint page becomes three tasks.
export function routeInfo(hash = globalThis.location?.hash || "#/") {
  const [path, rest] = (hash.replace(/^#/, "") || "/").split("#");
  const requested = path.split("?")[0];
  const query = new URLSearchParams(path.split("?")[1]);
  if (requested === "/fact-vs-artifact")
    return { route: "/integrate", anchor: "fact-vs-artifact", query };
  if (requested === "/whitelistcurator")
    return {
      route: "/about",
      anchor: rest === "hours" || rest === "source" ? rest : "whitelistcurator",
      query,
    };
  if (requested === "/explorer")
    return {
      route: "/catalog",
      anchor: query.get("trait") ? `trait-${query.get("trait")}` : "explorer",
      query,
    };
  let route =
    requested === "/claim"
      ? "/mint"
      : requested === "/wallet-facts"
        ? "/wallet"
        : requested;
  let anchor =
    rest === "shared-fact"
      ? "pick-1201"
      : rest?.replace(/^shared-(\d+)$/, "pick-$1");
  if (route === "/mint") {
    if (anchor === "step-03") route = "/register";
    else if (
      query.has("trait") ||
      /^(?:step-02|mint-facts|add-traits|pick-\d+)$/.test(anchor || "")
    )
      route = "/request";
    else if (anchor === "step-01") anchor = "snapshot";
  }
  return { route, anchor, query };
}

export function taskAnchor(id, hash = globalThis.location?.hash || "#/mint") {
  const current = routeInfo(hash);
  const target =
    id === "step-03"
      ? "/register"
      : id === "step-02" || /^pick-/.test(id)
        ? "/request"
        : id === "mint"
          ? "/mint"
          : TASKS.some(([path]) => path === current.route)
            ? current.route
            : "/mint";
  const query =
    current.route === target && current.query.toString()
      ? `?${current.query}`
      : "";
  return `#${target}${query}#${id}`;
}
