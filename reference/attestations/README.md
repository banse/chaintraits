# Served attestations (mainnet, EIP-712 `IdentityMD Oracle` v2)

Five attestations the plane served at `GET /oracle/requests/:id/attestation`. Each file carries `domain`, `types`,
`message`, `signature` and `signer`; the two consumer files also carry the Intake context under `intake`. A required
test recovers `0x5598aa9146215bc13eb26f2c692ad1461fd32982` from every one, with `bytes answer` hashed as
`keccak256(answer)`, under the file's own domain, and fails to under any other domain. The served `answerType` is a
name (`"bool"`, `"uint256"`); the signed field is `uint8` (0 bool, 1 address, 2 bytes32, 3 uint256, 4 address[],
5 bytes32[]); a loader maps the name and rejects unknown names.

| file | domain `verifyingContract` | answerType | answer | panel | note |
|---|---|---|---|---|---|
| `2026-10-10-link-pilot.json` | zero | bool | true | 11 / 7, agreed 7 | x402 request without a consumer; a panel question about a public transaction |
| `2026-10-11-nonce-true.json` | zero | bool | true | 11 / 7, agreed 7 | Intake v1, no callback, no consumer; template T5 (2026-10-11 wording) for a public figure's address |
| `2026-10-11-nonce-false.json` | zero | bool | false | 11 / 7, agreed 7 | x402 request without a consumer; template T5 (2026-10-11 wording) for the synthetic `0x…c1a1` |
| `2026-10-10-meatbag-consumer.json` | `0x70c1…787b` (a third party's contract; its callback target and its body's `consumer`) | uint256 | 2 | 7 / 4, agreed 4 | Intake v1 with a callback; `delivered == true`; the calldata of `complete` carries this exact tuple and signature |
| `2026-10-11-feed-consumer-v2.json` | `0x014d…5d7a` (a third party's `SwarmFeed`, named as `consumer` in the body; the callback target was another contract) | uint256 | a 1e18-scaled index | 100 / 51, agreed 53 | Intake v2 `requestWithFailure`; `delivered == true`; shows that the domain follows the body's `consumer`, not the callback target |

Three facts these files establish, used by `INTEGRATION.md` section 4:

1. **The signed `requestId` is the plane's oracle request UUID**, right-padded to 32 bytes (`0x03f89e74…`,
   `0x0ef60725…`), and never the Intake's keccak `requestId`. `reference/intake/completions.json` shows both ids side
   by side for all five completions.
2. **The domain's `verifyingContract` is the body's `consumer.verifyingContract`**, zero when the body named none.
3. **All five are the 15-field struct.** An older record (2026-10-08, before the plane's "attestation v2" release)
   served attestations without `panelSize`, `quorum` and `agreed`; no completion since carries that shape and the
   registry accepts only the 15-field one.

No attestation signed for this registry exists yet: its first real request (Sepolia rehearsal, then mainnet) will be
added here.
