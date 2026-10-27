import test from 'node:test';
import assert from 'node:assert/strict';
import { cardImageSvg, escapeXml, wrap } from '../src/fact-check/card-image.mjs';

test('card image text wraps at whole words and cuts only words longer than a line', () => {
  assert.deepEqual(wrap('At least 5 paid requests to the swarm', 12), ['At least 5', 'paid', 'requests to', 'the swarm']);
  assert.deepEqual(wrap('0x887b86B6B6957F7bbeA88B8CEfD392f39236A88C', 21), ['0x887b86B6B6957F7bbeA', '88B8CEfD392f39236A88C']);
  assert.equal(escapeXml('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
});

test('the card image carries the fact, the wallet with its ENS name, the result and the artwork', () => {
  const svg = cardImageSvg({
    title: 'IDENTITY.MD JURY', label: 'FACT', question: 'At least 5 paid requests to the swarm between the start and 2026-10-26',
    factName: 'Early Flock', wallet: '0x887b86B6B6957F7bbeA88B8CEfD392f39236A88C', ensName: 'hisdudeness.eth',
    saved: ['✓ SWORN BY SWARM', '✓ FACT SAVED'], result: 'positive', footer: 'sworn.vibingco.de · Ethereum mainnet', art: '<rect width="1000" height="1000"/>',
  });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1600" height="1000"/);
  for (const part of ['IDENTITY.MD JURY', 'EARLY FLOCK', '0x887b86B6B6957F7bbeA', '88B8CEfD392f39236A88C', 'hisdudeness.eth', '✓ FACT SAVED', 'sworn.vibingco.de · Ethereum mainnet'])
    assert.ok(svg.includes(`>${part}<`), part);
  assert.match(svg, /<svg x="500" y="150" width="600" height="600" viewBox="0 0 1000 1000"><rect width="1000" height="1000"\/><\/svg>/);
  assert.match(svg, /<circle cx="1330" cy="620" r="72" fill="#0d140d" stroke="#00ff41"/);
  const no = cardImageSvg({ title: 'T', question: 'Q', factName: 'F', wallet: '', saved: ['× FACT NOT ADDED'], result: 'negative' });
  assert.match(no, /stroke="#ff7777"/);
  assert.ok(no.includes('>Wallet not reported<') && !no.includes('hisdudeness'));
});
