# Audits and reviews

Everything that reviewed this code, in order, with the entrant's disposition of each finding. v1 is deployed as it is
(`DEPLOYMENTS.md`); accepted fixes land in a v2 redeploy, tracked in the issues. The known issues of v1 in plain words
are in `DISCLOSURE.md`.

| Date | Document | Target | Result |
|---|---|---|---|
| 2026-10-11 | `2026-10-11-code-review-brief-job-1.md` | swarm job 1 output, branch `swarm/job-1` at `7a9307c` | the brief for two independent reviews (Codex, Claude) of the first build |
| 2026-10-12 | `2026-10-12-review-round-2-dispositions.md` | the brief at `7ad6f93` | 17 findings (4 blockers, 10 should-fix, 3 nits), applied in `f6c52f9` before the swarm built the launch candidate |
| 2026-10-18 | `2026-10-18-swarm-launch-audit-c3792acf.md` | frozen candidate `59e9bf04` (= `v1-mainnet`) | the plane's five audit nodes and judge: two lows (uint16 spec-id cap, spec-id front-run), launch accepted unchanged |
| 2026-10-19 | `2026-10-19-onedollaraudit-1033.md` (+ `.report.md`, byte-identical, sha256 `181646c4981b4b46…`) | deployed Registry `0x39bec764…95a6` | 0 critical, 1 high, 5 medium, 7 low, 14 informational; disposition table at the end of the file |

Every H/M/L finding of the One Dollar Audit and both lows of the launch audit have an issue number or a written
reason; the open decisions (#1, #8, #9, #13) are the owner's.
