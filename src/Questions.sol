// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
// Generated from approved fixtures by tools/gen_questions.py.
import {Text} from "./Text.sol";

library Questions {
    bytes constant BLOB =
        "|16count |18count as one integer; |03methodeth_getLogs on |17log query. Count |01windowThe |0f|16sum the ~E |1bof |18sum as one integer in the argument's raw units (no decimals applied); |03eth_getLogs on |17log query. Sum the named |1bof |01unitsRaw integer |14|16sum the ~E |1bof the `~C` events emitted by the contract ~B grouped by the indexed ~D |1b(topic ~M of the log), never by a data field. Return the ~F keys with |04eth_getLogs over exactly the pinned window; group by the indexed ~D |1b(the log's topic ~M, an address: left-pad 12 zero bytes), never by a data word; sum ~E in raw units; sort descending by sum and break ties by lowercase address ascending; include |11At the last block of the request's pinned window (toBlock ~H) on |10One eth_call of the function with ~A as the |1bat block ~H (hex, not 'latest') on |0b|1a~H, block hash 0x43ac0aadac9b134a5e4555d28323431664fd77d74cd6a28cb4ca65e34ba72256; |1din which the WhitelistCurator contract 0xcb0b0531e86a9ac36fa865ca8e3dbccf047fda91 was deployed), was the account |19|00falsefalse only if |1cstate returns a count at block ~H below ~F (~L). If you could not read |08Call eth_getTransactionCount(~A, ~H) (hex block, not 'latest') on |1cstate, e.g. https://rpc.mevblocker.io or https://eth.drpc.org; cite endpoint and call. Pruned or unavailable state, errors or null |02truetrue only if an |0dThe window is the single block ~K; it fixes which chain state to read. It is not |13Up to block ~K on Ethereum mainnet, did |0aFour steps, executed in order as one procedure: seats (step 1), agent (step 2), accepted (step 3), answer (step 4). Every read is of Ethereum mainnet archive logs and state up to block ~K inclusive. A pruned, null or partial log read, or an |07seatsStep 1, seats. Every Transfer(from, to, tokenId; all indexed) log of the IdentityMD collection 0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D from block 25090085 to ~K whose from or to is ~A. Per tokenId, a holding interval runs from |1dof a transfer to the wallet (inclusive) to |1dof the next transfer of that token away from it (exclusive); an |09agentStep 2, the agents of a seat. The AgentBound(uint256 indexed agentId, uint8 indexed standard, address indexed tokenContract, uint256 tokenId, address registeredBy) logs of the adapter 0xde152AfB7db5373F34876E1499fbD893A82dD336 with tokenContract equal to the collection and tokenId equal to the seat. An agent is bound to the seat from |1d|12acceptedStep 3, accepted jobs. The NewFeedback logs (topic 0 0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc) of the reputation registry 0x8004baa17c55a88189ae136b182e5fda19de9b63 whose topic 2 is the batcher 0xb6d0a187b050fa5bb0b87033a203f37becf4a775, whose second data word (bytes 32 to 63) equals 1, whose block lies inside one of the wallet's holding intervals of a seat, and whose topic 1 is an agent |15answerStep 4, the answer. true when the entries of step 3, summed over every seat the |0ctrue only if |06false only if complete historical log reads establish fewer than 3 entries under the method. If a read |05The window |0e|1a~H; the last block of the spec's window), was the account |19|00";
    bytes constant OFFSETS =
        "00000025002b00510057005e00be00f200f7010601ab02a802ec0341041104160471053c0540055305a705d206c606cb0825082a098009880b2c0b320b850b950bff0c0d0c50";
    bytes constant DICT =
        "at that block, at least ~F? This asks about the account's nonce in the chain state at that block, not about its transaction history.matching logs; do not deduplicate by transaction. Block numbers are hex.(flashbots, 1rpc, cloudflare, publicnode) are no evidence: use another endpoint with historical state. Explorer transaction lists are not the nonce and are not evidence.answer 0 if no such event exists.the largest sums, descending by sum, ties by address ascending (lowercase hex).is pruned, null, partial or unavailable, write no answer; never answer false from an incomplete read.complete historical log reads establish at least 3 entries under the method.endpoint without the window, is no evidence: write no answer, never false.the historical count, write no answer; never answer false from a pruned, null or 'latest' read.interval still open at ~K ends at ~K inclusive. Same-block transfers are ordered by log index.the wallet ~A operate an IdentityMD seat through at least 3 accepted Identity.md swarm jobs while it held that seat? Answer true or false.an endpoint with historical state; compare the raw integer return value with ~F using ~J. A null, pruned or 'latest' read is no evidence.wallet held, number at least 3; false otherwise. Count entries, not distinct jobs; a log whose second data word is not 1 counts nothing.endpoint with historical state returns a transaction count at block ~H of at least ~F (~L).is blocks 25090085 to ~K inclusive on Ethereum mainnet; it fixes which logs and chain state count. The current head is not the window.pinned window is the whole evidence; events outside it do not count.Ethereum mainnet, does the view function `~C` of the contract ~B return a value ~J ~F for the address ~A? Answer true or false.positions beyond ~F, agreement is on the first ~F. An entry that is not an address (12 leading zero bytes) is a wrong answer.of its AgentBound log on. A seat without a binding has no agent and counts nothing.a time range, and the current (latest) nonce is not the answer.units of the argument as emitted, e.g. wei for an ETH amount.bound to that seat at or before the log's block. Each such log is one entry.Within the request's pinned block window (fromBlock ~G to toBlock ~H, both inclusive) on Ethereum mainnet, the contract with topic0 = the event's signature hash and the indexed argument(s) as topics, over exactly the pinned window; or the equivalent explorer the `~C` events emitted by the contract ~B whose indexed ~D argument equals ~A~I. Answer the nonce of address ~A, as returned by eth_getTransactionCount At Ethereum mainnet block ~K (hex argument an endpoint with historical the block ";
    bytes constant DOFFSETS =
        "0000008400cc0175019601e5024a029602e0033f039d042704b0053805930619065d06dc075907ac07eb0828087408df097709d40a100a320a3b0a570a61";
    bytes constant QS = "000000050009000b000d00140021";
    bytes constant DEFS =
        "00010002000300040001000600070008000300040001000a0001000c000e000f000100100011001200030013000100150016001700180019001a001b001c001d0011001e000e001f00030020000e000f000100100011001200030013";
    bytes constant DP = "00000004000a000c000e00160026002e";

    function nibble(bytes1 c) private pure returns (uint256) {
        uint8 x = uint8(c);
        return x <= 57 ? x - 48 : x - 87;
    }

    function at(bytes memory o, uint256 n) private pure returns (uint256 v) {
        for (uint256 i; i < 4; ++i) {
            v = v * 16 + nibble(o[n * 4 + i]);
        }
    }

    function textAt(uint256 n) private pure returns (string memory) {
        bytes memory blob = BLOB;
        bytes memory offsets = OFFSETS;
        uint256 a = at(offsets, n);
        uint256 end = at(offsets, n + 1);
        Text.Buffer memory b = Text.buffer(6000);
        bytes memory d = DICT;
        bytes memory offs = DOFFSETS;
        uint256 start = a;
        for (uint256 i = a; i < end; ++i) {
            if (blob[i] == "|") {
                Text.slice(b, blob, start, i - start);
                uint256 t = nibble(blob[i + 1]) * 16 + nibble(blob[i + 2]);
                uint256 k = at(offs, t);
                Text.slice(b, d, k, at(offs, t + 1) - k);
                i += 2;
                start = i + 1;
            }
        }
        Text.slice(b, blob, start, end - start);
        return Text.finish(b);
    }

    function question(uint256 kind) internal pure returns (string memory) {
        return textAt(at(QS, kind - 1));
    }

    function definitions(uint256 kind) internal pure returns (string[] memory keys, string[] memory vals) {
        uint256 start = at(DP, kind - 1);
        uint256 count = (at(DP, kind) - start) / 2;
        bytes memory defs = DEFS;
        keys = new string[](count);
        vals = new string[](count);
        for (uint256 i; i < count; ++i) {
            keys[i] = textAt(at(defs, start + i * 2));
            vals[i] = textAt(at(defs, start + i * 2 + 1));
        }
    }
}
