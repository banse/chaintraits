import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  root: new URL("../", import.meta.url).pathname,
  configFile: false,
  server: { middlewareMode: true, ws: false },
});
test.after(() => vite.close());
const navigation = () => vite.ssrLoadModule("/src/site-navigation.tsx");

test("requested primary destinations stay visible and secondary destinations remain native links", async () => {
  const { SiteNavigation } = await navigation();
  const html = renderToStaticMarkup(
    createElement(SiteNavigation, { route: "/request" }),
  );
  const primary = html.slice(0, html.indexOf("<details"));
  assert.deepEqual(
    [...primary.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ["#/catalog", "#/mint", "#/request", "#/fact-check", "#/register", "#/about", "docs/index.html"],
  );
  assert.match(primary, /href="#\/request" aria-current="page"/);
  assert.match(html, /<summary[^>]*>More/);
  for (const href of [
    "#/register",
    "#/curator",
    "#/integrate",
    "#/about",
    "docs/index.html",
    "agents/sworn/SKILL.md",
  ])
    assert.ok(html.includes(`href="${href}"`), href);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
});

test("a secondary page stays identifiable in the closed More disclosure", async () => {
  const { SiteNavigation } = await navigation();
  const html = renderToStaticMarkup(
    createElement(SiteNavigation, { route: "/curator" }),
  );
  assert.match(html, /<summary[^>]*>More<span[^>]*>Curator<\/span><\/summary>/);
  assert.match(html, /href="#\/curator" aria-current="page"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
});

function browserFixture() {
  const saved = Object.fromEntries(
    ["document", "window", "MutationObserver"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const nodes = new Map();
  const doc = new EventTarget();
  const scrolls = [];
  const watchers = [];
  doc.getElementById = (id) => nodes.get(id) || null;
  const win = { scrollTo: (...args) => scrolls.push(args) };
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      watchers.push(this);
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: doc },
    window: { configurable: true, value: win },
    MutationObserver: { configurable: true, value: Observer },
  });
  function node(id, heading = null, interactive = false) {
    const attributes = new Map();
    const element = {
      id,
      matches: () => interactive,
      querySelector: () => heading,
      hasAttribute: (name) => attributes.has(name),
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      focus: () => {
        doc.activeElement = element;
        doc.dispatchEvent(new Event("focusin"));
      },
      scrollIntoView: () => scrolls.push(id),
    };
    nodes.set(id, element);
    return element;
  }
  return {
    doc,
    nodes,
    scrolls,
    node,
    mutate: () =>
      watchers
        .filter((watcher) => watcher.connected)
        .forEach((watcher) => watcher.callback()),
    watching: () => watchers.some((watcher) => watcher.connected),
    restore: () => {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

const route = (anchor, query = "") => ({
  route: "/request",
  anchor,
  query: new URLSearchParams(query),
});

test("a same-page section jump focuses its heading without resetting to main or the page top", async () => {
  const { focusRouteTarget } = await navigation();
  const browser = browserFixture();
  try {
    browser.node("main");
    const heading = browser.node("facts-title");
    browser.node("claimed-facts", heading);
    const stop = focusRouteTarget(route("claimed-facts"), true);
    assert.equal(browser.doc.activeElement, heading);
    assert.equal(heading.getAttribute("tabindex"), "-1");
    assert.deepEqual(browser.scrolls, ["claimed-facts"]);
    stop();
  } finally {
    browser.restore();
  }
});

test("an asynchronous anchor receives focus once, then stops watching", async () => {
  const { focusRouteTarget } = await navigation();
  const browser = browserFixture();
  try {
    browser.node("main");
    const stop = focusRouteTarget(route("claimed-facts"), true);
    assert.equal(browser.doc.activeElement, undefined);
    assert.equal(browser.watching(), true);
    const target = browser.node("claimed-facts");
    browser.mutate();
    assert.equal(browser.doc.activeElement, target);
    assert.equal(browser.watching(), false);
    assert.deepEqual(browser.scrolls, ["claimed-facts"]);
    stop();
  } finally {
    browser.restore();
  }
});

test("visitor interaction cancels a delayed anchor rather than stealing focus or scroll later", async () => {
  const { focusRouteTarget } = await navigation();
  for (const type of [
    "pointerdown",
    "keydown",
    "focusin",
    "wheel",
    "touchstart",
  ]) {
    const browser = browserFixture();
    try {
      browser.node("main");
      const stop = focusRouteTarget(route("claimed-facts"), true);
      const field = browser.node("question", null, true);
      browser.doc.activeElement = field;
      browser.doc.dispatchEvent(new Event(type));
      browser.node("claimed-facts");
      browser.mutate();
      assert.equal(browser.doc.activeElement, field, type);
      assert.deepEqual(browser.scrolls, [], type);
      assert.equal(browser.watching(), false, type);
      stop();
    } finally {
      browser.restore();
    }
  }
});

test("query-based fact targets and ordinary page navigation retain their destinations", async () => {
  const { focusRouteTarget } = await navigation();
  const browser = browserFixture();
  try {
    const main = browser.node("main");
    const input = browser.node("pick-601", null, true);
    focusRouteTarget(route(undefined, "trait=601"), false)();
    assert.equal(browser.doc.activeElement, input);
    assert.deepEqual(browser.scrolls, ["pick-601"]);
    assert.equal(input.hasAttribute("tabindex"), false);
    focusRouteTarget(route(undefined), false)();
    assert.equal(browser.doc.activeElement, main);
    assert.deepEqual(browser.scrolls, ["pick-601", [0, 0]]);
  } finally {
    browser.restore();
  }
});
