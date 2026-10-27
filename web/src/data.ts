export const HEADLINE = "Facts about wallets, onchain and sworn by the swarm.";
export const DESCRIPTION =
  "Sworn is an ownerless registry on Ethereum mainnet. It records verifiable facts about wallets, starting with 25 built on the 19,522 wallets in WhitelistCurator.sol: some read live from the chain, the rest proven by panels of IMD agents and signed. A card shows a wallet’s facts; any contract can check them. Everyone can add facts.".replace(
    "wallet’s",
    "wallet's",
  );
export const WHY =
  "WhitelistCurator.sol set out to curate a permissionless onchain allowlist of proven wallets, for mints, early access, airdrops or reputation, that a contract reads directly at mint time, with no merkle root and no snapshot. Its 66-hour game recorded 19,522 wallets that kept paying real gas, hour after hour, in a quiet market, and it left the reading of that record to builders. Sworn is built on it: it turns the record into facts any contract can check with hasTrait, so a mint or a grant can use the signal without indexing the list itself. Some facts are read live from the Curator, the rest are proven by the swarm, and anyone can add more.";
export const BUILT =
  "The deployed contracts and original site were built by Identity.md's swarm in paid jobs. Their job records are public. This frontend adds interface improvements while reading the same Ethereum contracts and Swarm request data.";
export const FEE =
  "the fee is forwarded to the BurnExecutor for bridging and burning on Base";
export const SWARMED =
  "Swarmed: at least 3 accepted swarm feedback entries while holding a seat. Counted up to 64 blocks before your request. If not yet proven, you can request verification again after more accepted work.";
export const NOCOIN =
  "Sworn has no coin of its own; its only token is the card.";
export const OWNERLESS =
  "The deployed Sworn contracts have no owner roles, upgrade path, pause or fee switch; dependencies are fixed at construction. MIT licensed. This static frontend reads Ethereum and the Swarm API directly; transactions require your connected wallet.";
export const classes = [
  {
    key: "direct",
    name: "Direct reads",
    label: "Direct",
    description:
      "Read from WhitelistCurator.sol. Live before minting; frozen on your card at mint. No oracle request, no claim fee.",
    how: "Mint a card to capture these facts.",
  },
  {
    key: "chain",
    name: "Chain-proven",
    label: "Chain",
    description:
      "Historical chain evidence, sworn by swarm. A panel of 5 IMD agents checks the recipe; 3 must agree. Each attempt costs the live oracle price per fact, even if no fact is proven.",
    how: "Choose a fact on Wallet Facts.",
  },
  {
    key: "shared",
    name: "Shared facts",
    label: "Shared",
    description:
      "One attested ranking, reusable by every listed wallet. A panel of 11 IMD agents needs 7 in agreement. The requester pays the full oracle price; applying a stored list costs only gas. The request fee is not refunded if no verdict is reached.",
    how: "Use Wallet Facts to request or apply a shared fact.",
  },
  {
    key: "panel",
    name: "Panel-sworn",
    label: "Panel",
    description:
      "A panel of 11 IMD agents examines a pinned rule; 7 must agree. Each attempt costs the live oracle price per fact. An attestation records agreement, not a guarantee against a mistaken answer.",
    how: "Choose a fact on Wallet Facts.",
  },
];
// Readable names of the four fixed block windows.
const W = {
  LIFE: "The whole game, hours 0–65",
  JUDGED: "Hours 24–65 of the game",
  FIRST1000: "The game's opening, until the 1,000th first deposit",
  DEPLOY: "At the game's first block",
};
export type Trait = {
  id: number;
  name: string;
  class: string;
  rule: string;
  window: string;
  family: number;
  rare: boolean;
};
const rows: [number, string, string, string, string][] = [
  [
    101,
    "Spawned",
    "direct",
    "Joined WhitelistCurator.sol",
    "Live before mint; frozen at mint",
  ],
  [
    201,
    "Zero-Shot, hour <= 1",
    "direct",
    "First deposit in hour 0 or 1",
    "Live before mint; frozen at mint",
  ],
  [
    202,
    "Zero-Shot, hour 0",
    "direct",
    "First deposit in hour 0",
    "Live before mint; frozen at mint",
  ],
  [
    301,
    "Hopper >= 3",
    "direct",
    "At least 3 deposits",
    "Live before mint; frozen at mint",
  ],
  [
    302,
    "Hopper >= 5",
    "direct",
    "At least 5 deposits",
    "Live before mint; frozen at mint",
  ],
  [
    303,
    "Hopper >= 10",
    "direct",
    "At least 10 deposits",
    "Live before mint; frozen at mint",
  ],
  [
    401,
    "Bullfrog >= 1 ETH",
    "direct",
    "Largest single send ≥ 1 ETH",
    "Live before mint; frozen at mint",
  ],
  [
    402,
    "Bullfrog >= 10 ETH",
    "direct",
    "Largest single send ≥ 10 ETH",
    "Live before mint; frozen at mint",
  ],
  [
    403,
    "Bullfrog >= 100 ETH",
    "direct",
    "Largest single send ≥ 100 ETH",
    "Live before mint; frozen at mint",
  ],
  [
    404,
    "Bullfrog >= 800 ETH",
    "direct",
    "Largest single send ≥ 800 ETH",
    "Live before mint; frozen at mint",
  ],
  [
    501,
    "Benchmarked >= 1000",
    "direct",
    "At least 1,000 points",
    "Live before mint; frozen at mint",
  ],
  [
    502,
    "Benchmarked >= 3162",
    "direct",
    "At least 3,162 points",
    "Live before mint; frozen at mint",
  ],
  [
    503,
    "Benchmarked >= 10000",
    "direct",
    "At least 10,000 points",
    "Live before mint; frozen at mint",
  ],
  [
    601,
    "Swarmed",
    "panel",
    SWARMED,
    "From the start of the IdentityMD collection to 64 blocks before your request",
  ],
  [701, "Uptime", "chain", "Deposited again in hours 24–65", W.JUDGED],
  [801, "Holdout", "chain", "Deposited in hour 64", W.LIFE],
  [901, "Final Token", "chain", "Made a qualifying deposit in hour 65", W.LIFE],
  [1001, "Hotfix", "chain", "Saved an hour with HourSaved", W.LIFE],
  [1101, "PID #1", "chain", "FirstDeposit index 1", W.LIFE],
  [1102, "PID #1000", "chain", "FirstDeposit index 1,000", W.LIFE],
  [1103, "PID #10000", "chain", "FirstDeposit index 10,000", W.LIFE],
  [1104, "PID #19522", "chain", "FirstDeposit index 19,522", W.LIFE],
  [
    1105,
    "First thousand",
    "chain",
    "First deposit among the first 1,000",
    W.FIRST1000,
  ],
  [1201, "Top Weights", "shared", "Top 32 by summed weightAdded", W.LIFE],
  [
    1301,
    "Pretrained",
    "panel",
    "Account nonce ≥ 20 at launch of WhitelistCurator",
    W.DEPLOY,
  ],
];
export const TRAITS: Trait[] = rows.map(([id, name, c, rule, window]) => ({
  id,
  name,
  class: c,
  rule,
  window,
  family: Math.floor(id / 100),
  rare: [202, 801, 901, 1001, 1101, 1102, 1103, 1104, 1201].includes(id),
}));
export const FAMILIES = [
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
export const ROUTES = [
  ["/", "Home"],
  ["/catalog", "Explorer"],
  ["/mint", "Sworn Card"],
  ["/request", "Wallet Facts"],
  ["/fact-check", "Fact Check"],
  ["/register", "Community Facts"],
  ["/curator", "Curator"],
  ["/integrate", "Integrate"],
  ["/about", "About"],
];
export const WINDOWS = [
  [W.LIFE, "25,769,870", "25,789,604"],
  [W.JUDGED, "25,777,045", "25,789,604"],
  [W.FIRST1000, "25,769,870", "25,770,897"],
  [W.DEPLOY, "25,769,870", "25,769,870"],
];
