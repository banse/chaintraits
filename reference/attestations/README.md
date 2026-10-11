# Served attestations (mainnet, EIP-712 `IdentityMD Oracle` v2)

Three attestations the plane signed for requests without a callback (`verifyingContract` is the zero address, so a
registry test must rebuild the digest with ITS OWN address as `verifyingContract` for its own requests and with the
zero address for these). Each file carries `domain`, `types`, `message`, `signature` and `signer`. A required test:
`ECDSA.recover(_hashTypedDataV4(structHash(message)), signature) == 0x5598aa9146215bc13eb26f2c692ad1461fd32982` for
all three, with `bytes answer` hashed as `keccak256(answer)`.

| file | answerType | answer | panel | note |
|---|---|---|---|---|
| `2026-10-10-link-pilot.json` | bool | true | 11 / 7, agreed 7 | a panel question about a public transaction |
| `2026-10-11-nonce-true.json` | bool | true | 11 / 7, agreed 7 | template T5 for a public figure's address |
| `2026-10-11-nonce-false.json` | bool | false | 11 / 7, agreed 7 | template T5 for the synthetic `0x…c1a1` |

All three are the 15-field struct of `INTEGRATION.md` section 4. An older record (2026-10-08, before the plane's
"attestation v2" release) served attestations without `panelSize`, `quorum` and `agreed`; see INTEGRATION.md section 4
for how the registry treats that shape. No attestation with a non-zero `verifyingContract` is vendored yet; one real
request from a throwaway consumer is planned before the candidate freeze and will be added here.
