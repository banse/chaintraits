// This step's ten items on the production export, with a fake EIP-1193
// wallet and fake RPC/API answers. Nothing is signed or sent.
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { fakeChain, fakeWallet, mockPage, sharedSpec } from "./fake-chain.mjs";
import { emptySeparators } from "./separators.mjs";
import { server } from "./harness.mjs";

const output = new URL("../../test/scratch/sworn-step/", import.meta.url);
fs.mkdirSync(output, { recursive: true });
const preview = await server();
const evidence = { checks: [], errors: [], separators: [] };
let browser, context, page, fixture;
const normal = (s) => s.replace(/\s+/g, " ").trim();
const ROUTES = ["#/", "#/catalog", "#/mint", "#/wallet", "#/integrate", "#/about"];
const ACCENT = "rgb(0, 255, 65)";
const MUTED = "rgb(140, 150, 142)";
const TEXT = "rgb(217, 224, 218)";
const nonceSpec = {
  ...sharedSpec,
  kind: 5,
  item: "",
  arg: "",
  sumArg: "",
  threshold: 20n,
  fromBlock: 25769870n,
  toBlock: 25769870n,
  name: "Pretrained",
};
const communitySpec = {
  ...sharedSpec,
  kind: 1,
  sumArg: "",
  threshold: 2n,
  name: "Twice Deposited",
};
async function run(name, fn) {
  await fn();
  evidence.checks.push(name);
  console.log("PASS " + name);
}
async function setup({ route = "#/mint", connected = true, options = {} } = {}) {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await fakeWallet(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => evidence.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") evidence.errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      evidence.errors.push(`Local ${r.status()}: ${r.url()}`);
  });
  fixture = fakeChain({ allowance: 10n ** 22n, ...options });
  const answer = fixture.answer;
  // Nonce 5 at the launch block: 1301's rule (nonce >= 20) is not met.
  fixture.answer = (p) =>
    p.method === "eth_getTransactionCount" ? "0x5" : answer(p);
  await mockPage(page, fixture);
  await page.route("https://api.imd.fun/**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ requests: [], entries: [] }),
    }),
  );
  await page.goto(preview.url + route);
  await page.getByText(/Dependencies verified/).waitFor();
  if (connected) {
    await page.getByRole("button", { name: "Connect", exact: true }).first().click();
    await page.getByRole("button", { name: "Browser wallet", exact: true }).click();
    await page.getByRole("button", { name: /Disconnect/ }).waitFor();
  }
}
async function layout(label) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= width, `${label} ${width}: overflow ${scroll}`);
    const empty = await page.evaluate(emptySeparators);
    evidence.separators.push({ label, width, empty });
    assert.deepEqual(empty, [], `${label} ${width}: empty separator pair`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
const style = (locator, ...props) =>
  locator.evaluate(
    (e, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(e)[p]])),
    props,
  );
try {
  browser = await chromium.launch();
  await run(
    "1,2 Wallet: direct pairs, sworn rows with types, short lines, no proof details, green titles, new intro",
    async () => {
      await setup({
        route: "#/wallet",
        options: {
          token: 7n,
          traits: [101, 201, 301, 601, 701, 1301],
          verifiedSpecs: [10001],
          nextSpecId: 10002,
          specs: { 1301: nonceSpec, 10001: communitySpec },
        },
      });
      await page.locator("#held-10001").waitFor();
      assert.equal(
        normal(await page.locator("main > p.prose").first().innerText()),
        "Your wallet's Sworn record: every fact it holds and what each fact says.",
      );
      const main = normal(await page.locator("main").innerText());
      for (const gone of [
        "frozen at the card's mint",
        "Evidence window",
        "Oracle request",
        "Attested",
      ])
        assert.ok(!main.includes(gone), `wallet still shows ${gone}`);
      const titles = page.locator(".fact-group-title");
      assert.deepEqual(await titles.allInnerTexts(), [
        "Direct facts",
        "Sworn WhitelistCurator facts",
        "Sworn Community facts",
      ]);
      for (const i of [0, 1, 2])
        assert.equal((await style(titles.nth(i), "color")).color, ACCENT);
      const rows = await page.locator(".fact-history li").evaluateAll((es) =>
        es.map((e) => ({
          id: e.id,
          cells: [...e.children].map((c) => c.textContent.trim()),
          group: e.closest(".fact-group").querySelector("h3").textContent,
          sideBySide:
            e.children[1].getBoundingClientRect().x >=
              e.children[0].getBoundingClientRect().right &&
            Math.abs(
              e.children[1].getBoundingClientRect().y -
                e.children[0].getBoundingClientRect().y,
            ) < 4,
        })),
      );
      const by = Object.fromEntries(rows.map((r) => [r.id, r]));
      assert.deepEqual(by["held-601"].cells, ["601 / Swarmed", "Accepted swarm jobs >= 3", "Panel-sworn"]);
      assert.deepEqual(by["held-701"].cells, ["701 / Uptime", "Deposited again in hours 24–65", "Chain-proven"]);
      assert.deepEqual(by["held-1301"].cells, ["1301 / Pretrained", "Account nonce ≥ 20 at launch of WhitelistCurator", "Panel-sworn"]);
      assert.deepEqual(by["held-101"].cells, ["101 / Spawned", "Joined WhitelistCurator.sol"]);
      assert.equal(by["held-10001"].cells.length, 3);
      assert.equal(by["held-101"].group, "Direct facts");
      assert.equal(by["held-601"].group, "Sworn WhitelistCurator facts");
      assert.equal(by["held-10001"].group, "Sworn Community facts");
      // Direct facts retain paired columns; sworn facts add their type.
      for (const r of rows) assert.ok(r.sideBySide, r.id);
      const lists = await page.locator(".fact-history").evaluateAll((es) =>
        es.map((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length),
      );
      assert.deepEqual(lists, [4, 3, 3]);
      await page.screenshot({ path: new URL("wallet-1280.png", output).pathname, fullPage: true });
      await layout("#/wallet grouped");
      // A group with no fact shows no title.
      await setup({ route: "#/wallet", options: { token: 7n, traits: [101, 201] } });
      await page.locator("#held-201").waitFor();
      assert.deepEqual(await page.locator(".fact-group-title").allInnerTexts(), [
        "Direct facts",
      ]);
    },
  );
  await run(
    "3,4,6 Mint: green 19px step titles with grey 15px tails; grey 02 intros at the note's size with a blank line; three quiet info items",
    async () => {
      await setup();
      await page.getByText("1 direct facts present.", { exact: false }).waitFor();
      const titles = await page.locator(".step-title").evaluateAll((es) =>
        es.map((e) => {
          const name = e.querySelector(".step-name"),
            tail = e.querySelector(".step-description");
          const s = (el) => getComputedStyle(el);
          return {
            text: e.textContent.replace(/\s+/g, " ").trim(),
            name: name.textContent.trim(),
            size: s(e).fontSize,
            nameColor: s(name).color,
            nameSize: s(name).fontSize,
            tailColor: s(tail).color,
            tailSize: s(tail).fontSize,
          };
        }),
      );
      assert.deepEqual(
        titles.map((t) => t.text),
        [
          "01 – Direct WhitelistCurator facts – written onchain, readable from the contract",
          "02 – Sworn WhitelistCurator facts – provable onchain, sworn by the swarm",
          "03 – Sworn Community facts – not limited to WhitelistCurator",
        ],
      );
      for (const t of titles) {
        assert.match(t.name, /^0\d – .+ –$/);
        assert.equal(t.size, "19px");
        assert.equal(t.nameSize, "19px");
        assert.equal(t.nameColor, ACCENT);
        assert.equal(t.tailColor, MUTED);
        assert.equal(t.tailSize, "15px");
      }
      const intro = await page.locator("#step-02").evaluate((step) => {
        const lines = [...step.querySelectorAll(".step-intros > p")];
        const note = step.querySelector(".step-intros + p");
        const s = (e) => getComputedStyle(e);
        return {
          starts: lines.map((p) => p.textContent.split(" · ")[0]),
          lines: lines.map((p) => ({ color: s(p).color, size: s(p).fontSize })),
          names: lines.map((p) => {
            const b = p.querySelector("strong");
            return { color: s(b).color, weight: s(b).fontWeight };
          }),
          note: note.textContent.trim().slice(0, 42),
          noteColor: s(note).color,
          noteSize: s(note).fontSize,
          lineHeight: s(note).lineHeight,
          gap:
            note.getBoundingClientRect().top -
            lines.at(-1).getBoundingClientRect().bottom,
        };
      });
      assert.deepEqual(intro.starts, ["Chain-proven", "Shared facts", "Panel-sworn"]);
      assert.equal(intro.note, "Chain-proven facts use 5 agents / quorum 3");
      assert.equal(intro.noteColor, MUTED);
      for (const l of intro.lines) assert.deepEqual(l, { color: MUTED, size: intro.noteSize });
      for (const n of intro.names) assert.deepEqual(n, { color: TEXT, weight: "600" });
      assert.ok(
        Math.abs(intro.gap - parseFloat(intro.lineHeight)) < 1,
        `blank line above the note: ${intro.gap} vs ${intro.lineHeight}`,
      );
      const why = page.locator(".why-facts");
      assert.equal(await why.locator("a").count(), 0);
      assert.ok(!(await why.innerText()).includes("Mint a card"));
      const items = await why.locator(".why-steps > li").evaluateAll((es) =>
        es.map((e) => ({
          title: e.querySelector("strong").textContent,
          text: e.querySelector("p").textContent,
          color: getComputedStyle(e).color,
          x: Math.round(e.getBoundingClientRect().x),
          size: getComputedStyle(e.querySelector("p")).fontSize,
        })),
      );
      assert.deepEqual(
        items.map(({ title, text }) => [title, text]),
        [
          ["→ Request a fact", "Choose facts in 02 and pay the live oracle price, per fact."],
          [
            "→ Agents check the rule",
            "A panel of IMD agents checks your wallet against the fact's rule and block window.",
          ],
          [
            "→ Your card updates",
            "When the panel agrees, the fact lands on your card and in your wallet's record.",
          ],
        ],
      );
      for (const i of items) {
        assert.equal(i.color, MUTED);
        assert.equal(i.size, "12px");
      }
      assert.equal(new Set(items.map((i) => i.x)).size, 3, "three columns at 1280");
      await page.setViewportSize({ width: 390, height: 844 });
      const phone = await why
        .locator(".why-steps > li")
        .evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().x)));
      assert.equal(new Set(phone).size, 1, "one column at 390");
      await why.screenshot({ path: new URL("why-390.png", output).pathname });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator("#step-01").screenshot({ path: new URL("step-01.png", output).pathname });
      await page.locator("#step-02 .step-intros").screenshot({
        path: new URL("step-02-intros.png", output).pathname,
      });
    },
  );
  await run(
    "5 a not-met 1301 keeps its row when selected; the dialog shows the same note; no row disappears",
    async () => {
      await setup({ options: { token: 7n, traits: [101], specs: { 1301: nonceSpec } } });
      await page.waitForFunction(() => document.querySelector(".minted-card") && !document.querySelector("#pick-1301"));
      await page.locator('#step-02 .eligibility-toggle[aria-pressed="false"]').click();
      await page.locator("#pick-1301").waitFor();
      const before = await page.locator(".trait-picker > [id^=pick-]").evaluateAll((es) => es.map((e) => e.id));
      const row = page.locator("#pick-1301");
      await row.locator("input").check();
      const note = row.locator(".eligibility-advice");
      await note.getByText(/does not meet this rule/).waitFor();
      // Stay a moment past the check: the row must not vanish afterwards.
      await page.waitForTimeout(500);
      assert.equal(await row.isVisible(), true);
      assert.equal(await row.locator("input").isChecked(), true);
      const rowText = normal(await note.innerText());
      assert.match(rowText, /nonce 5/);
      const after = await page.locator(".trait-picker > [id^=pick-]").evaluateAll((es) => es.map((e) => e.id));
      assert.deepEqual(after, before);
      await page.getByRole("button", { name: "Mint selected facts", exact: true }).click();
      const dialog = page.locator(".payment-dialog");
      await dialog.getByText(rowText, { exact: true }).waitFor();
      assert.equal(normal(await note.innerText()), rowText);
      await page.keyboard.press("Escape");
      // Selecting every visible paid fact removes none of their rows.
      for (const id of before) {
        const box = page.locator(`#${id} input[type=checkbox]`);
        if ((await box.count()) && (await box.isEnabled()) && !(await box.isChecked()))
          await box.check();
      }
      await page.waitForTimeout(1500);
      const all = await page.locator(".trait-picker > [id^=pick-]").evaluateAll((es) =>
        es.filter((e) => e.checkVisibility()).map((e) => e.id),
      );
      for (const id of before) assert.ok(all.includes(id), `${id} disappeared`);
    },
  );
  await run(
    "7,8 Integrate's verification steps and note are grey with function names unchanged; About has no Contracts section or links row",
    async () => {
      await setup({ route: "#/integrate", connected: false });
      const verify = await page
        .locator(".verify-steps > li, .verify-steps + p")
        .evaluateAll((es) =>
          es.map((e) => ({
            color: getComputedStyle(e).color,
            code: [...e.querySelectorAll("code")].map((c) => [
              c.textContent,
              getComputedStyle(c).color,
              getComputedStyle(c).fontFamily,
            ]),
          })),
        );
      assert.equal(verify.length, 5);
      for (const v of verify) assert.equal(v.color, MUTED);
      const codes = verify.flatMap((v) => v.code);
      assert.deepEqual(
        codes.map((c) => c[0]),
        ["claimantOf(tokenId)", "hasTrait(claimant, traitId)", "verified(claimant, traitId)", "ownerOf"],
      );
      // Before this step the names inherited the body text colour and font.
      const body = await page.locator("body").evaluate((e) => [
        getComputedStyle(e).color,
        getComputedStyle(e).fontFamily,
      ]);
      for (const c of codes) assert.deepEqual(c.slice(1), body);
      await setup({ route: "#/about", connected: false });
      assert.equal(await page.getByRole("heading", { name: "Contracts" }).count(), 0);
      const main = await page.locator("main").innerText();
      for (const gone of ["Attested source", "earlier deployments", "Chain: "])
        assert.ok(!main.includes(gone), gone);
      // The links row after Contracts is gone (its links live in the footer).
      for (const name of ["Source repository ↗", "Identity.md ↗", "IMD agents ↗", "Sworn on X ↗"])
        assert.equal(await page.locator("main").getByRole("link", { name, exact: true }).count(), 0, name);
      // One separator where they stood: the footer rule follows the last section.
      const last = await page.evaluate(() => {
        const main = document.querySelector("main");
        const end = main.lastElementChild;
        return {
          title: end.querySelector("h2")?.textContent,
          endBorder: getComputedStyle(end).borderBottomWidth,
          mainBorder: getComputedStyle(main).borderBottomWidth,
          footerBorder: getComputedStyle(document.querySelector(".site-footer")).borderTopWidth,
        };
      });
      assert.deepEqual(last, {
        title: "The record and its lore",
        endBorder: "0px",
        mainBorder: "0px",
        footerBorder: "1px",
      });
      assert.equal(await page.locator("main .contracts").count(), 0);
      await layout("#/about");
    },
  );
  await run(
    "9,10 every page: footer row reads the line and four links in order; no controls; no empty separator pairs at 1280/390, also with a pending request",
    async () => {
      const expected = [
        ["Source repository ↗", "https://github.com/identity-md-launches/launch-2404-renderer-composer-registry"],
        ["Identity.md ↗", "https://imd.fun/"],
        ["IMD agents ↗", "https://imd.fun/docs"],
        ["Sworn on X ↗", "https://x.com/swornbyswarm"],
      ];
      for (const connected of [false, true]) {
        await setup({ route: "#/", connected, options: { token: 7n, traits: [101, 201, 301] } });
        for (const route of ROUTES) {
          await page.goto(preview.url + route);
          await page.getByRole("heading", { level: 1 }).waitFor();
          await page.getByText(/Dependencies verified/).waitFor();
          if (connected && route === "#/wallet") await page.locator("#held-101").waitFor();
          const bottom = page.locator(".footer-bottom");
          assert.equal(
            normal(await bottom.innerText()),
            "No owner. No backend. No coin. " + expected.map((e) => e[0]).join(" "),
          );
          assert.deepEqual(
            await bottom.locator("a").evaluateAll((es) => es.map((e) => [e.textContent, e.href])),
            expected,
          );
          assert.equal(await page.locator("footer select, footer button").count(), 0);
          const all = await page.locator("body").innerText();
          for (const gone of ["Deployment manifest", "About & sources", "Public RPC", "Retry reads"])
            assert.ok(!all.includes(gone), `${route}: ${gone}`);
          await layout(`${route} wallet=${connected}`);
        }
      }
      const pending = [
        {
          id: 601,
          requestId: "0x" + "a1".repeat(32),
          questionHash: "0x" + "b2".repeat(32),
          requestedAt: 1792600000n,
        },
      ];
      await setup({ options: { token: 7n, traits: [101, 201, 301], pending } });
      await page.locator("#step-02 .swarm-feed .swarm-request").waitFor();
      await page.locator("#step-02").screenshot({ path: new URL("step-02-pending.png", output).pathname });
      await layout("#/mint pending");
      await page.locator("#step-02 .swarm-request summary").first().click();
      await layout("#/mint pending opened");
      await setup({ route: "#/wallet", options: { token: 7n, traits: [101, 201, 301], pending } });
      await page.locator(".swarm-feed .swarm-request").waitFor();
      await layout("#/wallet pending");
    },
  );
  await run("no console errors or failed local resources", async () => {
    assert.deepEqual(evidence.errors, []);
  });
} finally {
  fs.writeFileSync(new URL("evidence.json", output), JSON.stringify(evidence, null, 2));
  await context?.close();
  await browser?.close();
  await preview.close();
}
