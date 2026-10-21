// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Spec, ICurator, IRegistryView} from "./Types.sol";
import {Catalog} from "./Catalog.sol";
import {SpecGrammar} from "./SpecGrammar.sol";
import {Text} from "./Text.sol";
import {Questions} from "./Questions.sol";

/// @notice Stateless compiler of the approved recipes. Arguments are trusted views; registration validates specs.
contract Composer {
    using Strings for uint256;
    using Text for Text.Buffer;
    error BadSpec(string field);
    error NotACatalogOracleTrait(uint16);
    uint16 public constant CHAIN_PANEL = 5;
    uint16 public constant CHAIN_QUORUM = 3;
    uint16 public constant PANEL_SIZE = 11;
    uint16 public constant PANEL_QUORUM = 7;
    uint256 public constant VALID_FOR_SECONDS = 2592000;
    address public constant MAINNET_CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;

    function DEPOSITED() external pure returns (string memory) {
        return Catalog.DEPOSITED;
    }

    function mainnetHeightBound() public view returns (uint256) {
        return block.timestamp <= 1663224191 ? 15537395 : 15537395 + (block.timestamp - 1663224191) / 12;
    }

    function catalogSpec(uint16 id, address curator) external pure returns (Spec memory) {
        return Catalog.spec(id, curator);
    }

    function validateSpec(Spec calldata s, uint256) external view {
        SpecGrammar.validate(s, block.chainid == 1 ? block.number : mainnetHeightBound());
    }

    function directSnapshot(address wallet, address curator) external view returns (uint32 bits) {
        if (wallet == address(0)) return 0;
        ICurator c = ICurator(curator);
        (uint256 hour, bool joined) = c.firstHourOf(wallet);
        if (!joined) return 0;
        bits = 1;
        if (hour <= 1) bits |= 16;
        if (hour == 0) bits |= 32;
        uint256 n = c.txCountOf(wallet);
        if (n >= 3) bits |= 256;
        if (n >= 5) bits |= 512;
        if (n >= 10) bits |= 1024;
        n = c.contributedBy(wallet);
        if (n >= 1 ether) bits |= 4096;
        if (n >= 10 ether) bits |= 8192;
        if (n >= 100 ether) bits |= 16384;
        if (n >= 800 ether) bits |= 32768;
        n = c.pointsOf(wallet);
        if (n >= 1000) bits |= 65536;
        if (n >= 3162) bits |= 131072;
        if (n >= 10000) bits |= 262144;
    }

    function traitsOf(address registry, address wallet) external view returns (uint16[] memory out) {
        uint16[25] memory all = Catalog.ids();
        out = new uint16[](25);
        uint256 n;
        for (uint256 i; i < 25; ++i) {
            if (IRegistryView(registry).hasTrait(wallet, all[i])) out[n++] = all[i];
        }
        assembly ("memory-safe") { mstore(out, n) }
    }

    struct Recipe {
        string question;
        string[] keys;
        string[] vals;
        string answerType;
        uint64 fromBlock;
        uint64 toBlock;
        uint8 kind;
        uint256 head;
    }

    function compose(uint16 id, Spec calldata spec, address claimant, address consumer, address)
        external
        view
        returns (bytes memory body, bytes32 questionHash)
    {
        Spec memory s = spec;
        if (Catalog.oracle(id)) s.target = MAINNET_CURATOR;
        if (s.kind == 6) {
            uint256 h = block.chainid == 1 ? block.number : mainnetHeightBound();
            if (h < 25090085 + 64) revert BadSpec("window");
            s.toBlock = uint64(h - 64);
        }
        Recipe memory r = _recipe(id, s, claimant);
        body = bytes(_body(r, consumer));
        questionHash = keccak256(bytes(_canonical(r)));
    }

    function _recipe(uint16 id, Spec memory s, address claimant) private pure returns (Recipe memory r) {
        string[16] memory a;
        a[0] = Strings.toHexString(claimant);
        a[1] = Strings.toHexString(s.target);
        a[2] = s.item;
        a[3] = s.arg;
        a[4] = s.sumArg;
        a[5] = s.threshold.toString();
        a[6] = Text.hexNumber(s.fromBlock);
        a[7] = Text.hexNumber(s.toBlock);
        if (bytes(s.fixedArg).length > 0) {
            a[8] = string.concat(" and whose indexed ", s.fixedArg, " argument equals ", s.fixedVal.toString());
        }
        if (s.op > 0 && s.op <= 5) {
            a[9] = s.op == 1 ? ">=" : s.op == 2 ? ">" : s.op == 3 ? "<=" : s.op == 4 ? "<" : "==";
        }
        a[10] = uint256(s.toBlock).toString();
        a[11] = Text.hexNumber(s.threshold);
        if (s.kind == 3) a[12] = uint256(SpecGrammar.fields(s)).toString();
        if (s.kind < 1 || s.kind > 6) revert BadSpec("kind");
        uint256 recipe = s.kind == 5 && id != 1301 ? 7 : s.kind;
        string memory q = Questions.question(recipe);
        (r.keys, r.vals) = Questions.definitions(recipe);
        r.question = Text.expand(q, a);
        if (bytes(r.question).length > 1000) revert BadSpec("question");
        for (uint256 i; i < r.vals.length; ++i) {
            r.vals[i] = Text.expand(r.vals[i], a);
            if (bytes(r.vals[i]).length > 512) revert BadSpec("definitions");
        }
        r.kind = s.kind;
        r.answerType = s.kind <= 2 ? "uint256" : s.kind == 3 ? "address[]" : "bool";
        r.fromBlock = s.fromBlock;
        r.toBlock = s.toBlock;
        r.head = s.threshold;
    }

    function _definitions(Recipe memory r, bool pretty) private pure returns (string memory) {
        Text.Buffer memory b = Text.buffer(6000);
        b.add(pretty ? "{\n" : "{");
        for (uint256 i; i < r.keys.length; ++i) {
            if (i > 0) b.add(pretty ? ",\n" : ",");
            if (pretty) b.add("    ");
            b.add(string.concat('"', r.keys[i], pretty ? '": "' : '":"', r.vals[i], '"'));
        }
        b.add(pretty ? "\n  }" : "}");
        return b.finish();
    }

    function _body(Recipe memory r, address consumer) private view returns (string memory) {
        Text.Buffer memory b = Text.buffer(16384);
        b.add(
            string.concat(
                '{\n  "answerType": "',
                r.answerType,
                '",\n  "chainId": 1,\n  "consumer": {\n    "chainId": ',
                block.chainid.toString(),
                ',\n    "verifyingContract": "',
                Strings.toHexString(consumer),
                '"\n  },\n  "definitions": '
            )
        );
        b.add(_definitions(r, true));
        b.add(string.concat(',\n  "evidence": "', r.kind >= 5 ? "panel" : "chain", '",\n'));
        if (r.kind == 3) b.add(string.concat('  "head": ', r.head.toString(), ",\n"));
        bool panel = r.kind == 3 || r.kind >= 5;
        b.add(
            string.concat(
                '  "panelSize": ',
                panel ? "11" : "5",
                ',\n  "question": "',
                r.question,
                '",\n  "quorum": ',
                panel ? "7" : "3",
                ',\n  "v": 1,\n  "validForSeconds": 2592000,\n  "window": {\n    "fromBlock": ',
                uint256(r.fromBlock).toString(),
                ',\n    "toBlock": ',
                uint256(r.toBlock).toString(),
                "\n  }\n}"
            )
        );
        return b.finish();
    }

    function _canonical(Recipe memory r) private pure returns (string memory) {
        // Only T6's fixture preserves recipe order; RFC 8785 sorts these keys.
        if (r.kind == 6) {
            uint8[8] memory order = [uint8(3), 2, 4, 6, 0, 1, 5, 7];
            string[] memory keys = new string[](8);
            string[] memory vals = new string[](8);
            for (uint256 i; i < 8; ++i) {
                keys[i] = r.keys[order[i]];
                vals[i] = r.vals[order[i]];
            }
            r.keys = keys;
            r.vals = vals;
        }
        Text.Buffer memory b = Text.buffer(10000);
        b.add(string.concat('{"answerType":"', r.answerType, '","chainId":1,"definitions":', _definitions(r, false)));
        if (r.kind >= 5) b.add(',"evidence":"panel"');
        if (r.kind == 3) b.add(string.concat(',"head":', r.head.toString()));
        b.add(
            string.concat(
                ',"question":"',
                r.question,
                '","v":1,"window":{"fromBlock":',
                uint256(r.fromBlock).toString(),
                ',"toBlock":',
                uint256(r.toBlock).toString(),
                "}}"
            )
        );
        return b.finish();
    }
}
