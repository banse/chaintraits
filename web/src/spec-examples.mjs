// Step 03 examples. Each prefills contract, signature, claimant field, sum
// field and comparison; name, threshold, block window and the hour value stay
// empty for the visitor to choose.
export const SEATS = "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D";
export const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const BROKER_PASS = "0xa6958cbc41325e97ecb3bb9d837fbd0938cb2b4f";
export const BALANCE_OF = "function balanceOf(address) view returns (uint256)";
export const SEAT_TRANSFER =
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)";
export const TOKEN_TRANSFER =
  "event Transfer(address indexed from, address indexed to, uint256 value)";
export const WETH_DEPOSIT = "event Deposit(address indexed dst, uint256 wad)";
export const CURATOR_DEPOSITED =
  "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)";

/** Examples per template ("1" to "5"); curator and imd come from the live deployment. */
export function specExamples({ curator, imd }) {
  const ex = (name, proves, fields) => ({ name, proves, fields });
  return {
    1: [
      ex(
        "IdentityMD seats received",
        "Proves the wallet received at least the threshold number of IdentityMD seats in the block window.",
        { target: SEATS, item: SEAT_TRANSFER, arg: "to" },
      ),
      ex(
        "WETH deposits",
        "Proves the wallet wrapped ETH into WETH at least the threshold number of times in the block window.",
        { target: WETH, item: WETH_DEPOSIT, arg: "dst" },
      ),
      ex(
        "WhitelistCurator deposits in one hour",
        "Proves the wallet made at least the threshold number of WhitelistCurator deposits in the hour you enter.",
        {
          target: curator,
          item: CURATOR_DEPOSITED,
          arg: "contributor",
          fixedArg: "hour",
        },
      ),
    ],
    2: [
      ex(
        "IMD received",
        "Proves the wallet received at least the threshold amount of IMD, in its smallest unit, in the block window.",
        { target: imd, item: TOKEN_TRANSFER, arg: "to", sumArg: "value" },
      ),
      ex(
        "WETH deposited",
        "Proves the wallet wrapped at least the threshold amount of ETH, in wei, into WETH in the block window.",
        { target: WETH, item: WETH_DEPOSIT, arg: "dst", sumArg: "wad" },
      ),
      ex(
        "ETH sent to WhitelistCurator",
        "Proves the wallet sent at least the threshold amount of ETH, in wei, to WhitelistCurator in the block window.",
        {
          target: curator,
          item: CURATOR_DEPOSITED,
          arg: "contributor",
          sumArg: "amount",
        },
      ),
    ],
    3: [
      ex(
        "Top WhitelistCurator senders",
        "Proves the wallet is among the threshold top senders of ETH to WhitelistCurator in the block window.",
        {
          target: curator,
          item: CURATOR_DEPOSITED,
          arg: "contributor",
          sumArg: "amount",
        },
      ),
      ex(
        "Top WhitelistCurator weight",
        "Proves the wallet is among the threshold top holders of added WhitelistCurator weight in the block window.",
        {
          target: curator,
          item: CURATOR_DEPOSITED,
          arg: "contributor",
          sumArg: "weightAdded",
        },
      ),
    ],
    4: [
      ex(
        "Holds IdentityMD seats",
        "Proves the wallet held at least the threshold number of IdentityMD seats at the window's last block.",
        { target: SEATS, item: BALANCE_OF, op: "1" },
      ),
      ex(
        "Holds IMD",
        "Proves the wallet held at least the threshold amount of IMD, in its smallest unit, at the window's last block.",
        { target: imd, item: BALANCE_OF, op: "1" },
      ),
      ex(
        "Holds a Proof House Broker Pass",
        "Proves the wallet held at least the threshold number of Proof House Broker Passes at the window's last block.",
        { target: BROKER_PASS, item: BALANCE_OF, op: "1" },
      ),
    ],
    5: [
      ex(
        "An active wallet",
        "Proves the wallet had sent at least the threshold number of transactions by the block you enter.",
        {},
      ),
    ],
  };
}

/** The form a template starts from: empty, except T4's view signature. */
export function templateStart(kind, empty) {
  return { ...empty, kind, item: kind === "4" ? BALANCE_OF : "" };
}

/** Apply an example over the template start; name, threshold, window and hour stay empty. */
export function applyExample(kind, example, empty) {
  return {
    ...templateStart(kind, empty),
    ...(example ? example.fields : {}),
    name: "",
    threshold: "",
    fromBlock: "",
    toBlock: "",
    fixedVal: "",
  };
}
