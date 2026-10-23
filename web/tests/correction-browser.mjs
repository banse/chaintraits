// The nine correction items and the reopened Close regression, exercised on
// the production export. All RPC/API replies and wallet results are synthetic.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium, webkit } from "playwright";
import { encodeFunctionData, zeroAddress } from "viem";
import {
  fakeChain,
  fakeWallet,
  mockPage,
  sharedSpec,
  wallet,
} from "./fake-chain.mjs";
import { server } from "./harness.mjs";

const output = new URL(
  `../../test/scratch/correction${process.argv.includes("--webkit") ? "-webkit" : ""}/`,
  import.meta.url,
);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const Registry = JSON.parse(
  fs.readFileSync(new URL("../../dist/abi/Registry.json", import.meta.url)),
);
const mintData = encodeFunctionData({
  abi: Registry,
  functionName: "mintCard",
});
const hash = "0x" + "66".repeat(32);
const uuid = "23474d49-bf7c-40e0-8dad-41636c73ea84";
const request = "0x" + "a1".repeat(32);
const proof = [
  request,
  "0x" + uuid.replaceAll("-", "") + "00".repeat(16),
  25769870n,
  25789604n,
];
const intro =
  "Your wallet's Sworn record: every fact it holds, what each fact says, and how it was proven, with the oracle request behind every panel-sworn fact.";
const directIds = [101, 201, 202, 301, 302, 303, 401, 402, 403, 404];
const community = {
  ...sharedSpec,
  name: "Community deposit weights",
  threshold: 2n,
};
const evidence = { checks: [], errors: [], widths: [] };
let browser, context, page, fixture, control;
const selected = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
async function run(name, fn) {
  if (selected && !name.startsWith(selected)) return;
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function connect() {
  await page
    .getByRole("button", { name: "Connect", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Browser wallet", exact: true })
    .click();
}
async function setup({
  route = "#/mint",
  options = {},
  connected = true,
} = {}) {
  await context?.close();
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await fakeWallet(context);
  // Delay only the fake provider's response, with explicit release/rejection.
  // No request is forwarded to a wallet or the network.
  await context.addInitScript(() => {
    const original = window.ethereum.request.bind(window.ethereum);
    window.ethereum.request = (args) => {
      if (args.method === "eth_sendTransaction" && window.__holdSignature) {
        window.__signing.push(args);
        return new Promise((resolve, reject) => {
          window.__resolveSignature = resolve;
          window.__rejectSignature = () =>
            reject(
              Object.assign(Error("Fake wallet rejected; nothing sent"), {
                code: 4001,
              }),
            );
        });
      }
      return original(args);
    };
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  fixture = fakeChain({ allowance: 10n ** 22n, ...options });
  control = {
    holdSimulation: false,
    simulationStarted: false,
    holdReceipt: false,
  };
  const base = fixture.answer;
  fixture.answer = async (p) => {
    if (
      control.holdSimulation &&
      p.method === "eth_call" &&
      p.params[0].data === mintData
    ) {
      control.simulationStarted = true;
      await new Promise((resolve) => {
        control.releaseSimulation = resolve;
      });
    }
    if (control.holdReceipt && p.method === "eth_getTransactionReceipt")
      return null;
    return base(p);
  };
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", async (r) => {
    const url = new URL(r.request().url());
    const body =
      url.pathname === `/oracle/requests/${uuid}`
        ? {
            id: uuid,
            jobId: "correction-fixture",
            attestedAt: "2026-10-20T08:15:00.000Z",
          }
        : url.pathname === "/oracle/requests"
          ? { requests: [] }
          : { entries: [] };
    await r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(preview.url + route);
  await page.getByText(/Dependencies verified/).waitFor();
  if (connected) await connect();
}
const dialog = () => page.locator(".payment-dialog");
const close = () =>
  dialog().getByRole("button", { name: "Close", exact: true }).click();
const hide = () =>
  dialog().getByRole("button", { name: "Close payment dialog" }).click();
const mint = () =>
  page.locator("#mint").getByRole("button", { name: "Mint card", exact: true });
const acknowledge = () => dialog().locator("#payment-ack").check();
async function prepare() {
  await mint().click();
  await dialog().waitFor({ state: "visible" });
}
async function absent() {
  await page.waitForFunction(
    () => !document.querySelector("#transaction-steps"),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Review transaction steps" })
      .count(),
    0,
  );
  const journal = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sworn.transaction-journal")),
  );
  assert.equal(journal.plan, null);
  assert.deepEqual(journal.steps, []);
}
async function widths(name) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const actual = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    assert.ok(actual <= width, `${name}: ${actual} > ${width}`);
    evidence.widths.push({ name, width, actual });
  }
}
function near(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `${message}: ${actual} / ${expected}`,
  );
}
try {
  browser = await (
    process.argv.includes("--webkit") ? webkit : chromium
  ).launch();
  await run(
    "1 Wallet intro uses p.prose directly under the title with and without a wallet",
    async () => {
      await setup({ route: "#/wallet", connected: false });
      const p = page.locator("h1 + p.prose");
      assert.equal(await p.innerText(), intro);
      await connect();
      await page
        .getByRole("heading", { name: "Claimed facts", exact: true })
        .waitFor();
      assert.equal(await p.innerText(), intro);
      await widths("wallet-intro");
    },
  );
  await run(
    "2 ten direct facts form five aligned full-width rows; every fact has its catalog meaning and panel proof",
    async () => {
      await setup({
        route: "#/catalog",
        options: {
          token: 1n,
          mintedAtBlock: 26242890n,
          proven: [...directIds.slice(1), 801],
          nextSpecId: 10002,
          specs: { 10001: community },
          verifiedSpecs: [10001],
          verifiedRecords: { 801: proof, 10001: proof },
        },
      });
      const expected = new Map();
      for (const row of await page.locator("#direct .catalog-row").all()) {
        const label = await row.locator('[role="cell"]').nth(0).innerText();
        expected.set(Number(label.split(" / ")[0]), {
          label,
          meaning: await row.locator('[role="cell"]').nth(1).innerText(),
        });
      }
      const panelRule = await page
        .locator("#chain .catalog-row")
        .filter({ hasText: "801 / Holdout" })
        .locator('[role="cell"]')
        .nth(1)
        .evaluate((el) => el.firstChild.textContent);
      const communityRule = await page
        .locator("#community .fact-row p")
        .innerText();
      await page.goto(preview.url + "#/wallet");
      await page.locator("#held-10001 .meaning").waitFor();
      const direct = page.locator(".direct-facts > li");
      assert.equal(await direct.count(), 10);
      assert.equal(await page.locator(".direct-note").count(), 1);
      assert.match(
        await page.locator(".direct-note").innerText(),
        /^Direct · frozen at the card's mint, block 26,242,890 · .* UTC$/,
      );
      for (const id of directIds) {
        const row = page.locator(`#held-${id}`);
        assert.equal(
          await row.locator("strong").innerText(),
          expected.get(id).label,
        );
        assert.equal(
          await row.locator(".meaning").innerText(),
          expected.get(id).meaning,
        );
        assert.doesNotMatch(
          await row.innerText(),
          /Direct ·|frozen at|read live/,
        );
      }
      const main = await page.locator("main").evaluate((el) => {
        const box = el.getBoundingClientRect(),
          css = getComputedStyle(el);
        const left = parseFloat(css.paddingLeft),
          right = parseFloat(css.paddingRight);
        return { x: box.x + left, width: box.width - left - right };
      });
      const list = await page.locator(".direct-facts").boundingBox();
      near(list.x, main.x, "direct list left edge");
      near(list.width, main.width, "direct list fills content");
      const boxes = await direct.evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            name: el.querySelector("strong").getBoundingClientRect().x,
            meaning: el.querySelector(".meaning").getBoundingClientRect().x,
          };
        }),
      );
      assert.equal(new Set(boxes.map((b) => b.y)).size, 5);
      for (let i = 0; i < 10; i += 2) {
        near(boxes[i].y, boxes[i + 1].y, "two facts share each row");
        assert.ok(boxes[i + 1].x > boxes[i].x);
        for (const j of [i, i + 1]) {
          near(boxes[j].name, boxes[j % 2].name, "name column aligned");
          near(
            boxes[j].meaning,
            boxes[j % 2].meaning,
            "meaning column aligned",
          );
        }
      }
      for (const [id, meaning] of [
        [801, panelRule],
        [10001, communityRule],
      ]) {
        const row = page.locator(`#held-${id}`);
        assert.equal(await row.locator(".meaning").innerText(), meaning.trim());
        await row
          .getByText("Evidence window: blocks 25,769,870 → 25,789,604", {
            exact: true,
          })
          .waitFor();
        await row.getByRole("link", { name: uuid }).waitFor();
        const text = await row.locator(".proof-lines").innerText();
        assert.ok(
          text.indexOf(meaning.trim()) < text.indexOf("Evidence window:"),
        );
        assert.ok(
          text.indexOf("Evidence window:") < text.indexOf("Oracle request:"),
        );
      }
      await page.screenshot({
        path: new URL("wallet-1280.png", output).pathname,
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const phone = await direct.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().x),
      );
      assert.equal(new Set(phone).size, 1);
      assert.equal(
        new Set(
          await direct.evaluateAll((els) =>
            els.map((el) => el.getBoundingClientRect().y),
          ),
        ).size,
        10,
      );
      await page.screenshot({
        path: new URL("wallet-390.png", output).pathname,
        fullPage: true,
      });
      await widths("claimed-facts");
      await setup({
        route: "#/wallet",
        options: { proven: directIds.slice(1) },
      });
      await page
        .getByText("Direct · read live; no card minted", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".direct-note").count(), 1);
    },
  );
  await run(
    "3 switching IMD and ETH discards unsent preparations without an exception",
    async () => {
      await setup();
      for (const currency of ["ETH", "IMD"]) {
        await prepare();
        await hide();
        await page.getByRole("radio", { name: currency, exact: true }).check();
        await absent();
        assert.equal(
          await page
            .getByRole("radio", { name: currency, exact: true })
            .isChecked(),
          true,
        );
      }
      assert.equal(await page.evaluate(() => window.__signing.length), 0);
    },
  );
  await run(
    "4 Close during a running simulation discards it and ignores the late result",
    async () => {
      await setup();
      await prepare();
      control.holdSimulation = true;
      await acknowledge();
      await dialog().getByText("simulating", { exact: true }).waitFor();
      await page.waitForFunction(
        () => !document.querySelector(".journal-steps .primary:not(:disabled)"),
      );
      // The state renders before the RPC; wait for the deterministic barrier.
      const deadline = Date.now() + 15000;
      while (!control.simulationStarted && Date.now() < deadline)
        await page.waitForTimeout(10);
      assert.ok(
        control.simulationStarted,
        "simulation reached the fake RPC barrier",
      );
      await close();
      await absent();
      control.holdSimulation = false;
      control.releaseSimulation();
      await prepare();
      await acknowledge();
      await dialog().getByText("simulated", { exact: true }).waitFor();
      await close();
      await absent();
      await page.reload();
      await page.getByText(/Dependencies verified/).waitFor();
      assert.equal(await page.locator("#transaction-steps").count(), 0);
      assert.equal(await page.evaluate(() => window.__signing.length), 0);
    },
  );
  await run(
    "4a Close and currency changes discard awaiting-signature plans; late success and rejection cannot revive or alter a new plan",
    async () => {
      for (const action of ["Close", "currency"]) {
        for (const reply of ["success", "rejection"]) {
          await setup();
          await prepare();
          await acknowledge();
          await dialog().getByText("simulated", { exact: true }).waitFor();
          await page.evaluate(() => {
            window.__holdSignature = true;
          });
          await dialog()
            .getByRole("button", { name: "Mint one Sworn card", exact: true })
            .click();
          await dialog()
            .getByText("awaiting signature", { exact: true })
            .waitFor();
          await page.waitForFunction(() => !!window.__resolveSignature);
          if (action === "Close") await close();
          else {
            await hide();
            await page.getByRole("radio", { name: "ETH", exact: true }).check();
          }
          await absent();
          await prepare();
          await page.evaluate(
            ({ reply, hash }) => {
              if (reply === "success") window.__resolveSignature(hash);
              else window.__rejectSignature();
            },
            { reply, hash },
          );
          await page.waitForTimeout(150);
          assert.deepEqual(
            await dialog()
              .locator(".journal-steps li > div > span")
              .allInnerTexts(),
            ["ready"],
          );
          assert.equal(await dialog().locator(".receipt").count(), 0);
          assert.equal(
            fixture.state.calls.filter(
              (p) => p.method === "eth_getTransactionReceipt",
            ).length,
            0,
          );
          await close();
          await absent();
        }
      }
    },
  );
  await run(
    "4b a sent pending transaction survives Close and reload without resending",
    async () => {
      await setup();
      control.holdReceipt = true;
      await prepare();
      await acknowledge();
      await dialog().getByText("simulated", { exact: true }).waitFor();
      await page.evaluate(() => {
        window.__accept = true;
      });
      await dialog()
        .getByRole("button", { name: "Mint one Sworn card", exact: true })
        .click();
      await dialog().getByText("pending", { exact: true }).waitFor();
      await close();
      await page
        .getByRole("button", { name: "Review transaction steps" })
        .waitFor();
      await page.reload();
      await page.getByText(/Dependencies verified/).waitFor();
      await page
        .getByRole("button", { name: "Review transaction steps" })
        .click();
      await dialog().getByText("unknown", { exact: true }).waitFor();
      assert.equal(
        await dialog()
          .getByRole("link", { name: `Receipt: ${hash}` })
          .count(),
        1,
      );
      assert.equal(await page.evaluate(() => window.__signing.length), 0);
    },
  );
  await run(
    "5 pending 1201 shows exactly one pending status line",
    async () => {
      await setup({
        options: {
          pending: [
            {
              id: 1201,
              claimant: zeroAddress,
              requestId: request,
              questionHash: "0x" + "b1".repeat(32),
              requestedAt: 1792600000n,
            },
          ],
        },
      });
      const row = page.locator("#pick-1201");
      await row.getByText("Request pending.", { exact: true }).waitFor();
      assert.equal(
        await row.getByText("Request pending.", { exact: true }).count(),
        1,
      );
      assert.equal(
        await row
          .getByText("A request is already pending.", { exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await row.innerText()).match(/request.*pending\./gi)?.length,
        1,
      );
    },
  );
  await run(
    "6 Catalog direct header states Live once and every rule cell has one line",
    async () => {
      await setup({ route: "#/catalog", connected: false });
      await page
        .getByRole("columnheader", { name: "Rule · window: Live", exact: true })
        .waitFor();
      const cells = page.locator(
        '#direct .catalog-row > [role="cell"]:nth-child(2)',
      );
      assert.equal(await cells.count(), 13);
      for (const cell of await cells.all()) {
        assert.equal((await cell.innerText()).split("\n").length, 1);
        assert.equal(await cell.locator(".rule").count(), 0);
        assert.doesNotMatch(await cell.innerText(), /\bLive\b/);
      }
      await widths("catalog");
    },
  );
  await run(
    "7 standalone prose spans the content on every page; beside-card text retains its column",
    async () => {
      for (const route of [
        "#/",
        "#/catalog",
        "#/mint",
        "#/wallet",
        "#/integrate",
        "#/about",
      ]) {
        await setup({ route, connected: false });
        const main = await page.locator("main").evaluate((el) => {
          const box = el.getBoundingClientRect(),
            css = getComputedStyle(el);
          const left = parseFloat(css.paddingLeft),
            right = parseFloat(css.paddingRight);
          return { x: box.x + left, width: box.width - left - right };
        });
        const selector =
          route === "#/"
            ? "main > .section p.prose"
            : "main > p.prose, main > .part > p.prose, main > .section > p.prose";
        const paragraphs = await page.locator(selector).all();
        assert.ok(paragraphs.length > 0, route);
        for (const p of paragraphs) {
          const box = await p.boundingBox();
          near(
            box.x + box.width,
            main.x + main.width,
            `${route} standalone right edge`,
          );
        }
        if (route === "#/catalog") {
          const prose = await page.locator("main > p.prose").boundingBox();
          const table = await page
            .locator(".catalog-table")
            .first()
            .boundingBox();
          near(prose.width, table.width, "prose and table width");
        }
        if (route === "#/mint") {
          const p = await page.locator(".claim-copy p").first().boundingBox();
          const card = await page.locator("#mint .card-figure").boundingBox();
          assert.ok(
            p.x + p.width < card.x,
            "beside-card prose stays in its column",
          );
        }
        await widths(route.replace(/[^a-z]/g, "") || "home");
      }
    },
  );
  await run(
    "8 Mint Card, Explorer and Mint facts share titles/intros; legacy Explorer links and the home form load and scroll without duplicate ids",
    async () => {
      await setup({ connected: false });
      assert.deepEqual(await page.locator(".part-title").allInnerTexts(), [
        "Mint Card",
        "Explorer",
        "Mint facts",
      ]);
      assert.equal(
        new Set(
          await page
            .locator(".part-title")
            .evaluateAll((els) =>
              els.map((el) => getComputedStyle(el).fontSize),
            ),
        ).size,
        1,
      );
      assert.deepEqual(
        await page.locator(".part-title + p.prose").allInnerTexts(),
        [
          "Mint your Sworn card. It captures your direct facts at mint and updates itself when new facts land.",
          "Look up any wallet: its card, the facts it holds and any open request, read straight from the Registry. No wallet connection is needed.",
          "Add facts to your wallet: chain-proven and panel-sworn facts are requested from the swarm's oracle and land on your card when its panel agrees.",
        ],
      );
      assert.equal(
        await page
          .locator("nav")
          .getByRole("link", { name: "Mint", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator("nav")
          .getByRole("link", { name: "Explorer", exact: true })
          .count(),
        0,
      );
      for (const trait of ["", "&trait=801"]) {
        await page.goto(`${preview.url}#/explorer?address=${wallet}${trait}`);
        await page
          .locator("#explorer")
          .getByText("Wallet facts loaded.", { exact: true })
          .waitFor();
        assert.equal(
          await page.locator("#explorer input[name=address]").inputValue(),
          wallet,
        );
        await page.waitForFunction(
          (id) => {
            const el = document.getElementById(id);
            return el && Math.abs(el.getBoundingClientRect().top - 24) < 16;
          },
          trait ? "trait-801" : "explorer",
        );
        assert.equal(
          await page
            .getByRole("heading", { name: "Mint Card", exact: true, level: 1 })
            .count(),
          1,
        );
      }
      await page.goto(preview.url);
      await page.getByLabel("Explore a wallet", { exact: true }).fill(wallet);
      await page.getByRole("button", { name: "Explore wallet" }).click();
      await page
        .locator("#explorer")
        .getByText("Wallet facts loaded.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#explorer input[name=address]").inputValue(),
        wallet,
      );
      await page.waitForFunction(
        () =>
          Math.abs(
            document.getElementById("explorer").getBoundingClientRect().top -
              24,
          ) < 16,
      );
      await connect();
      await prepare();
      assert.equal(
        await page
          .getByRole("heading", { name: "Transaction steps", exact: true })
          .count(),
        1,
      );
      assert.deepEqual(
        await page.locator("[id]").evaluateAll((els) => {
          const ids = els.map((el) => el.id);
          return ids.filter((id, i) => ids.indexOf(id) !== i);
        }),
        [],
      );
      await close();
      await widths("mint-explorer");
    },
  );
  await run(
    "9 Integrate agents line immediately follows its intro and opens both shipped files",
    async () => {
      await setup({ route: "#/integrate", connected: false });
      const line = page.locator("h1 + p.prose + p.agents-line");
      assert.equal(
        await line.innerText(),
        "For agents: Sworn for agents and llms.txt carry every fact id, the authentic addresses and RPC-only examples for checking a fact.",
      );
      for (const [label, file] of [
        ["Sworn for agents", "agents/sworn/SKILL.md"],
        ["llms.txt", "llms.txt"],
      ]) {
        const href = await line
          .getByRole("link", { name: label, exact: true })
          .getAttribute("href");
        assert.equal(
          new URL(href, page.url()).pathname,
          new URL(file, preview.url).pathname,
        );
        await line.getByRole("link", { name: label, exact: true }).click();
        assert.equal(
          new URL(page.url()).pathname,
          new URL(file, preview.url).pathname,
        );
        assert.equal(
          (await page.locator("body").innerText()).trimEnd(),
          fs
            .readFileSync(
              new URL("../../dist/" + file, import.meta.url),
              "utf8",
            )
            .trimEnd(),
        );
        await page.goBack();
      }
    },
  );
  assert.deepEqual(evidence.errors, []);
} finally {
  fs.writeFileSync(
    new URL("results.json", output),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser?.close();
  await preview.close();
}
