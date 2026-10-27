import test from "node:test";
import assert from "node:assert/strict";
import { routeInfo, taskAnchor, TASKS } from "../src/task-navigation.mjs";

test("each independent task has a stable destination", () => {
  assert.deepEqual(TASKS, [
    ["/mint", "Sworn Card"],
    ["/request", "Wallet Facts"],
    ["/register", "Community Facts"],
  ]);
  for (const [path] of TASKS) assert.equal(routeInfo(`#${path}`).route, path);
});

test("legacy mint links preserve the requested task and fact", () => {
  for (const prefix of ["/mint", "/claim"]) {
    assert.equal(routeInfo(`#${prefix}`).route, "/mint");
    for (const anchor of [
      "step-02",
      "mint-facts",
      "add-traits",
      "pick-601",
      "shared-fact",
      "shared-10003",
    ]) {
      assert.equal(routeInfo(`#${prefix}#${anchor}`).route, "/request", anchor);
    }
    assert.equal(routeInfo(`#${prefix}#step-03`).route, "/register");
    const request = routeInfo(`#${prefix}?trait=1201#shared-fact`);
    assert.equal(request.route, "/request");
    assert.equal(request.anchor, "pick-1201");
    assert.equal(request.query.get("trait"), "1201");
    assert.equal(routeInfo(`#${prefix}#step-01`).anchor, "snapshot");
  }
});

test("task progress links stay with their task while navigation keeps context", () => {
  assert.equal(
    taskAnchor("transaction-steps", "#/request?trait=601"),
    "#/request?trait=601#transaction-steps",
  );
  assert.equal(
    taskAnchor("transaction-steps", "#/register"),
    "#/register#transaction-steps",
  );
  assert.equal(
    taskAnchor("transaction-steps", "#/mint"),
    "#/mint#transaction-steps",
  );
  assert.equal(taskAnchor("step-02", "#/mint"), "#/request#step-02");
  assert.equal(
    taskAnchor("step-03", "#/request?trait=601"),
    "#/register#step-03",
  );
});

test("old Wallet bookmarks lead to the card or the relevant claimed facts", () => {
  assert.deepEqual(
    { ...routeInfo("#/wallet"), query: undefined },
    { route: "/mint", anchor: "your-card", query: undefined },
  );
  for (const link of ["#/wallet-facts", "#/wallet?view=history", "#/wallet#claimed-facts", "#/wallet#history"]) {
    const route = routeInfo(link);
    assert.equal(route.route, "/request", link);
    assert.equal(route.anchor, "claimed-facts", link);
  }
  for (const prefix of ["/wallet", "/wallet-facts"]) {
    const route = routeInfo(`#${prefix}?view=history#held-801`);
    assert.equal(route.route, "/request");
    assert.equal(route.anchor, "held-801");
    assert.equal(route.query.get("view"), "history");
  }
});

test("unrelated historical pages keep their original destination", () => {
  const explorer = routeInfo("#/explorer?address=0xabc&trait=101");
  assert.equal(explorer.route, "/catalog");
  assert.equal(explorer.anchor, "trait-101");
  assert.equal(explorer.query.get("address"), "0xabc");
  assert.equal(routeInfo("#/fact-vs-artifact").route, "/integrate");
  assert.equal(routeInfo("#/whitelistcurator#hours").anchor, "hours");
});
