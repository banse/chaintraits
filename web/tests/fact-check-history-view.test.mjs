import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("completed oracle requests retain agents and answers in live and history views", async () => {
  const vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, ws: false },
    appType: "custom",
  });
  try {
    const { FactCheckView } = await vite.ssrLoadModule(
      "/src/fact-check/FactCheckView.tsx",
    );
    const snapshot = {
      key: "saved",
      mode: "live",
      phase: "saved",
      wallet: "0x2000000000000000000000000000000000000001",
      factId: 601,
      factName: "Swarmed",
      question: "Did this wallet complete three accepted jobs?",
      shortQuestion: "At least three accepted jobs?",
      panelSize: 11,
      quorum: 7,
      agents: [
        { key: "agent-17", tokenId: "17", state: "agree", answer: "TRUE" },
        { key: "agent-23", tokenId: "23", state: "disagree", answer: "FALSE" },
      ],
      quorumReached: true,
      result: true,
      registryStored: true,
      cardImage: "data:image/svg+xml,%3Csvg/%3E",
      latestEvent: "Fact saved",
      events: [],
    };
    const html = renderToStaticMarkup(
      React.createElement(FactCheckView, { snapshot, variant: "history" }),
    );
    assert.match(html, /Did this wallet complete three accepted jobs/);
    assert.match(html, /fc-result-agents/);
    assert.match(html, /data-identity-token-id="17"/);
    assert.match(html, /IDMD #17: TRUE/);
    assert.match(html, /IDMD #23: FALSE/);
    assert.match(html, /fc-agent-layer fc-layer fc-layer-active/);
    assert.match(html, /FACT SAVED/);
    assert.match(html, /SWORN BY SWARM/);
    assert.doesNotMatch(html, /SWARM CONFIRMED/);
    assert.match(html, /class="fc-context"><div class="fc-fact"><h3 class="fc-context-label">FACT<\/h3><p class="fc-short-question">At least three accepted jobs\?<\/p><\/div><p class="fc-fact-name"><strong>Swarmed<\/strong>/);
    assert.match(html, /class="fc-answer" aria-live="polite"><div class="fc-wallet"><h3 class="fc-context-label">WALLET<\/h3><span>0x2000000000000000000000000000000000000001/);
    assert.doesNotMatch(html, /class="fc-verdict/);
    assert.match(html, /aria-label="Confirmed true"/);
    assert.doesNotMatch(html, /data:image\/svg\+xml|fc-returned-art|fc-new-fact/);
    for (const text of [
      "Request progress",
      "Open progress dialog",
      "Action feed",
      "fc-confirmation",
    ])
      assert.ok(!html.includes(text), `Unexpected history replay UI: ${text}`);
    const noMembers = renderToStaticMarkup(React.createElement(FactCheckView, {
      snapshot: { ...snapshot, agents: [], cardImage: undefined, cardless: true },
      variant: "history",
    }));
    assert.match(noMembers, /Agent data unavailable/);
    assert.match(noMembers, /FACT SAVED/);
    assert.doesNotMatch(noMembers, /data-identity-token-id|fc-returned-art|Loading your card/);
    const missingCard = renderToStaticMarkup(React.createElement(FactCheckView, {
      snapshot: { ...snapshot, phase: "registry", result: null, cardImage: undefined, cardError: "Metadata unavailable" },
      variant: "history",
    }));
    assert.match(missingCard, /fc-agent-layer fc-layer fc-layer-active/);
    assert.match(missingCard, /IDMD #17: TRUE/);
    assert.match(missingCard, /Registry confirmed/);
    assert.doesNotMatch(missingCard, /Loading your card|Card artwork unavailable|Waiting for the Registry update/);
    const direct = renderToStaticMarkup(
      React.createElement(FactCheckView, {
        snapshot: {
          ...snapshot,
          evidenceKind: "direct",
          factId: 0,
          factName: "Direct facts",
          panelSize: null,
          quorum: null,
        },
        variant: "history",
      }),
    );
    assert.match(direct, /Direct facts recorded at card mint/);
    assert.match(direct, /data:image\/svg\+xml/);
    assert.doesNotMatch(
      direct,
      /Oracle Question|Required agreement|IDENTITY.MD JURY/,
    );
    const progress = renderToStaticMarkup(
      React.createElement(FactCheckView, { snapshot }),
    );
    assert.match(progress, /Open progress dialog/);
    assert.match(progress, /fc-agent-layer fc-layer fc-layer-active/);
    assert.match(progress, /IDMD #17: TRUE/);
    assert.match(progress, /IDMD #23: FALSE/);
    assert.match(progress, /SWORN BY SWARM/);
    assert.match(progress, /FACT SAVED/);
    assert.match(progress, /aria-label="Confirmed true"/);
    assert.match(progress, /fc-confirmation/);
    assert.doesNotMatch(progress, /fc-returned-art|fc-new-fact|Loading your card|Refreshing your card|Waiting for the Registry update/);
    assert.match(progress, /Action feed/);
    const questionIndex = progress.indexOf('class="fc-question"');
    assert.ok(questionIndex > progress.indexOf('aria-label="Request progress"'));
    assert.ok(questionIndex < progress.indexOf('class="fc-quorum"'), "The Oracle Question is above Required agreement");
    assert.equal(progress.match(/>Oracle Question<\/h2>/g)?.length, 1);
    assert.match(progress, /<strong>7 \/ 11<\/strong>/);
    assert.match(progress, />IDENTITY.MD JURY<\/h2>/);
    const embedded = renderToStaticMarkup(
      React.createElement(FactCheckView, { snapshot, embedded: true }),
    );
    assert.match(embedded, /IDENTITY.MD JURY/);
    assert.doesNotMatch(embedded, /<dialog|Open progress dialog/);
    for (const missingArtwork of [
      { cardless: true },
      { cardError: 'Could not read card metadata.' },
    ]) {
      const withoutCard = renderToStaticMarkup(React.createElement(FactCheckView, {
        snapshot: { ...snapshot, cardImage: undefined, ...missingArtwork },
      }));
      assert.match(withoutCard, /fc-agent-layer fc-layer fc-layer-active/);
      assert.match(withoutCard, /IDMD #17: TRUE/);
      assert.match(withoutCard, /IDMD #23: FALSE/);
      assert.match(withoutCard, /FACT SAVED/);
      assert.doesNotMatch(withoutCard, /fc-returned-art|Wallet fact record|Card artwork unavailable|Waiting for the Registry update/);
    }
    const negative = renderToStaticMarkup(React.createElement(FactCheckView, {
      snapshot: { ...snapshot, phase: 'negative', result: false },
    }));
    assert.match(negative, /fc-agent-layer fc-layer fc-layer-active/);
    assert.match(negative, /IDMD #23: FALSE/);
    assert.match(negative, /aria-label="Confirmed false"/);
    assert.match(negative, /FACT NOT ADDED/);
    assert.doesNotMatch(negative, /FACT SAVED|fc-returned-art/);
    for (const variant of ['progress', 'history']) {
      const shared = renderToStaticMarkup(React.createElement(FactCheckView, {
        snapshot: { ...snapshot, factId: 1201, factName: 'Top Weights', answerKind: 'list', result: null },
        variant,
      }));
      assert.match(shared, /class="fc-result-mark" aria-label="Registry result confirmed"><span class="fc-result-badge" aria-hidden="true">✓<\/span>/);
      assert.match(shared, /✓ SWORN BY SWARM<\/span><span>✓ RESULT SAVED/);
      assert.doesNotMatch(shared, /Confirmed true|Confirmed false|FACT SAVED|REGISTRY RESULT CONFIRMED|Registry confirmed this result/);
    }
    const liveNoMembers = renderToStaticMarkup(React.createElement(FactCheckView, {
      snapshot: { ...snapshot, agents: [] },
    }));
    assert.match(liveNoMembers, /Agent data unavailable/);
    assert.match(liveNoMembers, /FACT SAVED/);
    assert.doesNotMatch(liveNoMembers, /fc-returned-art|fc-agent-layer/);
    for (const phase of ["tx", "admission", "panel", "quorum", "delivery", "registry"]) {
      const pending = renderToStaticMarkup(
        React.createElement(FactCheckView, {
          snapshot: { ...snapshot, phase, registryStored: false, result: null, cardImage: undefined },
        }),
      );
      // Trace nodes remain mounted; only layer opacity changes between phases.
      assert.match(pending, /class="fc-trace fc-inner-trace fc-layer/);
      assert.match(pending, /class="fc-trace fc-outer-trace fc-layer/);
      assert.equal(pending.includes('class="fc-trace fc-inner-trace fc-layer fc-layer-active"'), ["admission", "delivery", "registry"].includes(phase));
      assert.equal(pending.includes('class="fc-trace fc-outer-trace fc-layer fc-layer-active"'), ["tx", "registry"].includes(phase));
      assert.doesNotMatch(pending, /fc-outgoing-scene/);
      assert.doesNotMatch(pending, /class="fc-result-mark/);
      for (const [stage, label] of [['tx', 'TRANSACTION'], ['admission', 'SWARM REQUEST'], ['delivery', 'DELIVERY'], ['registry', 'REGISTRY']]) {
        const expression = new RegExp(`<g class="fc-waiting fc-layer${phase === stage ? ' fc-layer-active' : ''}"[^>]*aria-hidden="${phase !== stage}"[^>]*><text[^>]*>${label}</text><text[^>]*>PENDING</text>`);
        assert.match(pending, expression);
      }
    }
  } finally {
    await vite.close();
  }
});
