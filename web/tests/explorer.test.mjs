import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("Explorer request rows show live IMD prices or explicit unavailability", async () => {
  const vite = await createServer({
    root: new URL("../", import.meta.url).pathname,
    configFile: false,
    server: { middlewareMode: true },
  });
  const previousLocation = globalThis.location;
  try {
    const { WalletFactRows } = await vite.ssrLoadModule("/src/components.tsx");
    const { SiteContext } = await vite.ssrLoadModule("/src/context.tsx");
    globalThis.location = { hash: "#/explorer" };
    const facts = {
      address: "0x2000000000000000000000000000000000000001",
      traits: [],
      verifiedSpecs: [],
      answers: [],
      joined: false,
      pending: {},
      verified: {},
    };
    for (const [health, label] of [
      [null, "Live price unavailable"],
      [{ price: 500000000000000000n }, "0.50 IMD · priceOf · live"],
      [{ price: 6400000000000000000n }, "6.4 IMD · priceOf · live"],
    ]) {
      const html = renderToStaticMarkup(
        createElement(
          SiteContext.Provider,
          { value: { health } },
          createElement(WalletFactRows, { facts }),
        ),
      );
      assert.equal(html.split(label).length - 1, 2);
      assert.ok(html.includes('href="#/request?trait=601"'));
      assert.ok(html.includes('href="#/request?trait=1301"'));
      assert.ok(!html.includes('href="#/request?trait=701"'));
      if (!health) assert.ok(!/[\d.] IMD/.test(html));
    }
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    await vite.close();
  }
});
