# Current indexer integration validation

The current 2026-10-27 worker report is [artifacts/validation.md](../artifacts/validation.md). It records the completed production build, typecheck, 284 passing unit tests, production interactions at 1280/390, live read-only counts 5/47/0 and the four verified history requests, the six-domain Better Interface review and the 14/16 design-probe result.

Reproduce the task-specific checks after the [README build](README.md):

```sh
npm test
npx playwright install chromium
node tests/indexer-browser.mjs
SWORN_TEST_RPC=https://ethereum-rpc.publicnode.com node tests/indexer-live-browser.mjs
npm run verify:export
```

`indexer-browser.mjs --only=history` selects the history and source-switch regression; `--webkit` selects WebKit when its host libraries are available. Browser fixtures are read-only and refuse signing. Results/screenshots go to `test/scratch/`, which is not delivered. Captured API responses in `tests/fixtures/indexer/` are test data, never a production fallback.

The production interaction report has no unexpected console/page errors, local file errors or overflow. Deliberately aborted indexer requests produce expected network errors, recorded separately. WebKit launch was attempted but host shared libraries are missing. No real wallet signed and no paid request or mainnet write was created. The original public-RPC fallback can still reach its original deadline; it remains advisory and names the chain scan.

The pinned source's other test notes are historical. Current source, export/size checks, measured timings and review limitations are recorded in the linked report and JSON artifacts; the verifier does not independently certify those behavioral observations.
