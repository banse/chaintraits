// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {Spec} from "./interfaces/Types.sol";
import {ICurator} from "./interfaces/ICurator.sol";
import {IRegistryView} from "./interfaces/ISworn.sol";
import {Catalog} from "./lib/Catalog.sol";
import {Text} from "./lib/Text.sol";
import {SpecGrammar} from "./lib/SpecGrammar.sol";
import {RecipeText} from "./lib/RecipeText.sol";

/// @notice Stateless recipe composition. Direct callers choose the arguments; the Registry pins them.
contract Composer {
    error BadSpec(string field);
    error NotACatalogOracleTrait(uint16 traitId);
    address public constant MAINNET_CURATOR = 0xcB0b0531e86A9aC36Fa865cA8e3dbccF047FDA91;
    string public constant DEPOSITED =
        "event Deposited(address indexed contributor, uint256 indexed hour, uint256 amount, uint256 creditedDelta, uint256 weightAdded, uint256 newWeight, uint256 txCount, uint256 hourTotal, uint256 earlyBps)";
    uint16 public constant CHAIN_PANEL = 5;
    uint16 public constant CHAIN_QUORUM = 3;
    uint16 public constant PANEL_SIZE = 11;
    uint16 public constant PANEL_QUORUM = 7;

    function mainnetHeightBound() public view returns (uint256) {
        return 15537395 + (block.timestamp > 1663224191 ? (block.timestamp - 1663224191) / 12 : 0);
    }

    function validateSpec(Spec calldata s, uint256) external view {
        SpecGrammar.validate(s, block.chainid == 1 ? block.number : mainnetHeightBound());
    }

    function catalogSpec(uint16 id, address curator) external pure returns (Spec memory s) {
        if (!Catalog.oracle(id)) revert NotACatalogOracleTrait(id);
        s.kind = 1;
        s.target = curator;
        s.threshold = 1;
        s.fromBlock = 25769870;
        s.toBlock = 25789604;
        s.name = Catalog.name(id);
        s.item = DEPOSITED;
        s.arg = "contributor";
        if (id == 601) {
            s.kind = 6;
            s.target = 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D;
            s.item = "";
            s.arg = "";
            s.threshold = 3;
            s.fromBlock = 25090085;
            s.toBlock = 0;
        } else if (id == 701) {
            s.fromBlock = 25777045;
        } else if (id == 801 || id == 901) {
            s.fixedArg = "hour";
            s.fixedVal = id == 801 ? 64 : 65;
        } else if (id == 1001) {
            s.item = "event HourSaved(address indexed savior, uint256 indexed hour, uint256 hourTotal)";
            s.arg = "savior";
        } else if (id >= 1101 && id <= 1105) {
            s.item = "event FirstDeposit(address indexed contributor, uint256 indexed index, uint256 timestamp)";
            if (id == 1105) {
                s.toBlock = 25770897;
            } else {
                s.fixedArg = "index";
                s.fixedVal = id == 1101 ? 1 : id == 1102 ? 1000 : id == 1103 ? 10000 : 19522;
            }
        } else if (id == 1201) {
            s.kind = 3;
            s.sumArg = "weightAdded";
            s.threshold = 32;
        } else if (id == 1301) {
            s.kind = 5;
            s.target = address(0);
            s.item = "";
            s.arg = "";
            s.threshold = 20;
            s.toBlock = s.fromBlock;
        }
    }

    function directSnapshot(address wallet, address curator) external view returns (uint32 bits) {
        if (wallet == address(0)) return 0;
        (uint256 hour, bool joined) = ICurator(curator).firstHourOf(wallet);
        if (!joined) return 0;
        bits = 1;
        if (hour <= 1) bits |= 1 << 4;
        if (hour == 0) bits |= 1 << 5;
        uint256 n = ICurator(curator).txCountOf(wallet);
        if (n >= 3) bits |= 1 << 8;
        if (n >= 5) bits |= 1 << 9;
        if (n >= 10) bits |= 1 << 10;
        n = ICurator(curator).contributedBy(wallet);
        if (n >= 1 ether) bits |= 1 << 12;
        if (n >= 10 ether) bits |= 1 << 13;
        if (n >= 100 ether) bits |= 1 << 14;
        if (n >= 800 ether) bits |= 1 << 15;
        n = ICurator(curator).pointsOf(wallet);
        if (n >= 1000) bits |= 1 << 16;
        if (n >= 3162) bits |= 1 << 17;
        if (n >= 10000) bits |= 1 << 18;
    }

    function traitsOf(address registry, address wallet) external view returns (uint16[] memory result) {
        uint16[25] memory all = Catalog.ids();
        result = new uint16[](25);
        uint256 n;
        for (uint256 i; i < 25; ++i) {
            if (IRegistryView(registry).hasTrait(wallet, all[i])) result[n++] = all[i];
        }
        assembly { mstore(result, n) }
    }

    function _context(uint16 id, Spec memory s, address claimant) private pure returns (string[14] memory v) {
        v[0] = Text.hexnum(s.fromBlock);
        v[1] = Text.hexnum(s.toBlock);
        v[2] = Text.addr(claimant);
        v[3] = Text.addr(id < 10001 ? MAINNET_CURATOR : s.target);
        v[4] = s.item;
        v[5] = s.arg;
        if (bytes(s.fixedArg).length != 0) {
            v[6] = string.concat(" and whose indexed ", s.fixedArg, " argument equals ", Text.dec(s.fixedVal));
        }
        v[7] = s.sumArg;
        v[8] = Text.dec(s.threshold);
        v[9] = Text.hexnum(s.threshold);
        if (s.kind == 3) v[10] = Text.dec(SpecGrammar.eventFields(s));
        if (s.kind == 4) {
            string[5] memory ops = [string(">="), ">", "<=", "<", "=="];
            v[11] = ops[s.op - 1];
        }
        v[12] = Text.dec(s.toBlock);
        v[13] = id == 1301
            ? ", block hash 0x43ac0aadac9b134a5e4555d28323431664fd77d74cd6a28cb4ca65e34ba72256; the block in which the WhitelistCurator contract 0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91 was deployed"
            : "; the last block of the spec's window";
    }

    function _fill(string memory template, string[14] memory v) private pure returns (string memory out) {
        assembly {
            let src := add(template, 32)
            let end := add(src, mload(template))
            let n := mload(template)
            for { let p := src } lt(p, end) { p := add(p, 1) } {
                if eq(byte(0, mload(p)), 36) {
                    p := add(p, 1)
                    let value := mload(add(v, mul(sub(byte(0, mload(p)), 97), 32)))
                    n := add(sub(n, 2), mload(value))
                }
            }
            out := mload(64)
            mstore(out, n)
            let dst := add(out, 32)
            mstore(64, and(add(add(dst, n), 31), not(31)))
            for {} lt(src, end) { src := add(src, 1) } {
                let c := byte(0, mload(src))
                switch eq(c, 36)
                case 1 {
                    src := add(src, 1)
                    let value := mload(add(v, mul(sub(byte(0, mload(src)), 97), 32)))
                    let len := mload(value)
                    for { let i := 0 } lt(i, len) { i := add(i, 32) } {
                        mstore(add(dst, i), mload(add(add(value, 32), i)))
                    }
                    dst := add(dst, len)
                }
                default {
                    mstore8(dst, c)
                    dst := add(dst, 1)
                }
            }
        }
    }

    struct Question {
        string question;
        string[] keys;
        string[] vals;
        string answerType;
        string evidence;
        uint16 panel;
        uint16 quorum;
    }

    function compose(uint16 id, Spec calldata spec, address claimant, address consumer, address)
        external
        view
        returns (bytes memory body, bytes32 questionHash)
    {
        Spec memory s = spec;
        if (s.kind == 6) {
            uint256 h = block.chainid == 1 ? block.number : mainnetHeightBound();
            s.toBlock = uint64(h > uint256(s.fromBlock) + 64 ? h - 64 : s.fromBlock);
        }
        string[14] memory v = _context(id, s, claimant);
        Question memory q;
        q.question = _fill(RecipeText.question(s.kind), v);
        (q.keys, q.vals) = RecipeText.definitions(s.kind);
        for (uint256 i; i < q.vals.length; ++i) {
            q.vals[i] = _fill(q.vals[i], v);
            if (bytes(q.vals[i]).length > 512) revert BadSpec("definitions");
        }
        if (bytes(q.question).length > 1000) revert BadSpec("question");
        q.answerType = s.kind <= 2 ? "uint256" : s.kind == 3 ? "address[]" : "bool";
        q.evidence = s.kind >= 5 ? "panel" : "chain";
        (q.panel, q.quorum) = Catalog.panel(s.kind);
        body = _body(q, s, consumer);
        questionHash = keccak256(_canonical(q, s));
    }

    function _defs(Question memory q, bool pretty) private pure returns (string memory result) {
        result = pretty ? "{\n" : "{";
        // T6 retains its procedure order in the body and sorts only the canonical document.
        uint8[8] memory order = [uint8(3), 2, 4, 6, 0, 1, 5, 7];
        for (uint256 i; i < q.keys.length; ++i) {
            uint256 j = q.keys.length == 8 && !pretty ? order[i] : i;
            result = string.concat(
                result,
                pretty ? "    " : "",
                Text.quote(q.keys[j], false),
                pretty ? ": " : ":",
                Text.quote(q.vals[j], false)
            );
            result = string.concat(result, i + 1 == q.keys.length ? (pretty ? "\n  }" : "}") : (pretty ? ",\n" : ","));
        }
    }

    function _canonical(Question memory q, Spec memory s) private pure returns (bytes memory) {
        string[14] memory v;
        v[0] = q.answerType;
        v[1] = _defs(q, false);
        v[2] = s.kind >= 5 ? ',"evidence":"panel"' : "";
        v[3] = s.kind == 3 ? string.concat(',"head":', Text.dec(s.threshold)) : "";
        v[4] = Text.quote(q.question, false);
        v[5] = Text.dec(s.fromBlock);
        v[6] = Text.dec(s.toBlock);
        return bytes(
            _fill(
                '{"answerType":"$a","chainId":1,"definitions":$b$c$d,"question":$e,"v":1,"window":{"fromBlock":$f,"toBlock":$g}}',
                v
            )
        );
    }

    function _body(Question memory q, Spec memory s, address consumer) private view returns (bytes memory) {
        string[14] memory v;
        v[0] = q.answerType;
        v[1] = Text.dec(block.chainid);
        v[2] = Text.addr(consumer);
        v[3] = _defs(q, true);
        v[4] = q.evidence;
        v[5] = s.kind == 3 ? string.concat('  "head": ', Text.dec(s.threshold), ",\n") : "";
        v[6] = Text.dec(q.panel);
        v[7] = Text.quote(q.question, false);
        v[8] = Text.dec(q.quorum);
        v[9] = Text.dec(s.fromBlock);
        v[10] = Text.dec(s.toBlock);
        return bytes(
            _fill(
                '{\n  "answerType": "$a",\n  "chainId": 1,\n  "consumer": {\n    "chainId": $b,\n    "verifyingContract": "$c"\n  },\n  "definitions": $d,\n  "evidence": "$e",\n$f  "panelSize": $g,\n  "question": $h,\n  "quorum": $i,\n  "v": 1,\n  "validForSeconds": 2592000,\n  "window": {\n    "fromBlock": $j,\n    "toBlock": $k\n  }\n}',
                v
            )
        );
    }
}
