import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { builtInPicture, cellFacts, cellMarkup, mix, ringPicture, svgFromDataUri } from '../src/cell-pictures.mjs';

// Card SVGs from the deployed Renderer (eth_call of tokenURIOf with a Registry code override, the method of
// scripts/generate-art.mjs, no transaction): filled-601-ring1 has the same Swarmed cell as card #2.
const card = (name) => fs.readFileSync(new URL(`./fixtures/cells/${name}.svg`, import.meta.url), 'utf8');
const art = (id) => fs.readFileSync(new URL(`../public/art/trait-${id}.svg`, import.meta.url), 'utf8');
const SWARMED = [500, 480], HOPPER = [644, 563.1], SPAWNED = [500, 313.7];

test('cell markup is the whole cell group, nested clip groups included', () => {
  const cell = cellMarkup(card('hopper301-k2'), ...HOPPER);
  assert.match(cell, /^<polygon points="89\.0,0\.0/);
  assert.match(cell, /<g clip-path="url\(#h3\)">.*<\/g><g clip-path="url\(#a3\)">.*<\/g>$/);
  assert.equal(cellMarkup(card('hopper301-k2'), 1, 1), '');
});

test('a built-in fact is its cell on its trait card, on no background', () => {
  const svg = builtInPicture(art(601), ...SWARMED);
  assert.match(svg, /viewBox="-92 -92 184 184"/);
  assert.match(svg, /fill="#8ff0a4" fill-opacity="1\.00"/);
  assert.doesNotMatch(svg, /<rect|#151515/);
});

test('a ring of a filled cell is its band, composited as on the card', () => {
  const svg = ringPicture(card('filled-601-ring1'), ...SWARMED, 1);
  const colour = mix('#8ff0a4', 0.35, '#0a0a0a');
  assert.equal(colour, '#395b40');
  assert.match(svg, new RegExp(`<path d="M77\\.0,0\\.0 [^"]*Z M62\\.0,0\\.0 [^"]*Z" fill="${colour}" fill-rule="evenodd"/>`));
  assert.match(svg, /stroke="#151515"/);
  assert.doesNotMatch(svg, /fill-opacity/);
  const third = ringPicture(card('filled-601-k3'), ...SWARMED, 3);
  const stacked = mix('#8ff0a4', 0.78, mix('#8ff0a4', 0.57, mix('#8ff0a4', 0.35, '#0a0a0a')));
  assert.match(third, new RegExp(`M45\\.0,0\\.0 [^"]*Z M28\\.0,0\\.0 [^"]*Z" fill="${stacked}"`));
  assert.equal(ringPicture(card('filled-601-ring1'), ...SWARMED, 2), null);
});

test('a ring of a part-filled cell keeps the honey clip and its outline above the line', () => {
  const svg = ringPicture(card('hopper301-k2'), ...HOPPER, 2);
  assert.match(svg, /<defs><clipPath id="h3">/);
  assert.match(svg, /<g clip-path="url\(#h3\)"><path d="M62\.0,0\.0 [^"]*Z M45\.0,0\.0 [^"]*Z"/);
  assert.match(svg, /<g clip-path="url\(#a3\)"><polygon points="45\.0,0\.0[^"]*" fill="none" stroke="#05751f" stroke-width="2"\/><\/g>/);
});

test('a ring of an empty cell is its outline', () => {
  const svg = ringPicture(card('empty-ring1'), ...SWARMED, 1);
  assert.match(svg, /<polygon points="62\.0,0\.0[^"]*" fill="none" stroke="#05751f" stroke-width="3"\/>/);
  assert.match(ringPicture(card('hopper301-k2'), ...SPAWNED, 2), /<polygon points="45\.0,0\.0[^"]*" fill="none" stroke="#05751f"/);
});

test('cell facts of the selected cells keep table order and give community facts their ring', () => {
  const rows = [{ id: 101, family: 1 }, { id: 601, family: 6 }, { id: 10001, family: 6 }];
  const positions = [{ id: 10001, family: 6, ring: 1 }];
  assert.deepEqual(cellFacts(rows, [6], positions), [{ id: 601, family: 6, ring: null }, { id: 10001, family: 6, ring: 1 }]);
  assert.deepEqual(cellFacts(rows, [1, 6], positions).map((item) => item.id), [101, 601, 10001]);
  assert.deepEqual(cellFacts(rows, [], positions), []);
});

test('card images decode from both data URI forms', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>';
  assert.equal(svgFromDataUri(`data:image/svg+xml,${encodeURIComponent(svg)}`), svg);
  assert.equal(svgFromDataUri(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`), svg);
  assert.equal(svgFromDataUri('ipfs://x'), '');
});

test('a preview of every cell is the Renderer card: sample.svg with no community facts, full-house.svg with 32', async () => {
  const { previewCard, composeCard } = await import('../src/cell-pictures.mjs');
  const { communityDisplay } = await import('../src/card-facts.mjs');
  const src = fs.readFileSync(new URL('../src/hive-layout.ts', import.meta.url), 'utf8');
  const layout = [...src.matchAll(/family:\s*(\d+),\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)/g)].map((m) => ({ family: +m[1], x: +m[2], y: +m[3] }));
  assert.equal(layout.length, 13);
  const families = layout.map((cell) => cell.family);
  const rings = (count) => {
    const k = {};
    for (const { family } of communityDisplay(Array.from({ length: count }, (_, i) => 10001 + i), families).positions)
      k[family] = (k[family] ?? 0) + 1;
    return k;
  };
  const read = (name) => fs.readFileSync(new URL(`../public/art/${name}.svg`, import.meta.url), 'utf8');
  const sample = read('sample');
  assert.equal(previewCard(sample, layout, families, rings(0)), sample);
  assert.equal(previewCard(sample, layout, families, rings(32)), read('full-house'));
  const empty = composeCard(sample, layout, {});
  assert.equal(previewCard(sample, layout, [], rings(32)), empty);
  assert.doesNotMatch(empty, /fill-opacity/);
  const one = previewCard(sample, layout, [6], rings(1));
  assert.equal(cellMarkup(one, 500, 480), cellMarkup(card('filled-601-ring1'), 500, 480));
});
